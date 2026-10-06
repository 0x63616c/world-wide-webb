// Real WebKit HTTP-cache regression, not a source-text assertion. Run with
// `bun run test:panel-startup` after `bunx playwright install webkit`.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { webkit } from "playwright";
import { bootReportScript, bootUrl, RENDER_DEADLINE_MS } from "../apps/panel/boot-recovery";

let deployed = false;
const requests: string[] = [];
const server = createServer((request, response) => {
  const path = request.url ?? "/";
  requests.push(path);
  if (path.startsWith("/assets/")) {
    if (path === "/assets/old.js" && deployed) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": "application/javascript",
      // Reproduce an evicted old chunk while its HTML is still cached. The
      // CURRENT chunk remains cached, just as immutable production assets do.
      "Cache-Control": path === "/assets/old.js" ? "no-store" : "max-age=31536000, immutable",
    });
    response.end('document.getElementById("root").innerHTML="<main>Rendered</main>";');
    return;
  }
  response.writeHead(200, {
    "Content-Type": "text/html",
    // Historical entries had heuristic freshness. Explicit freshness makes
    // the regression deterministic without waiting for an old Last-Modified.
    "Cache-Control": deployed ? "no-cache" : "max-age=3600",
  });
  response.end(
    `<div id="root"></div><script type="module" src="/assets/${deployed ? "current" : "old"}.js"></script>`,
  );
});

const profile = await mkdtemp(join(tmpdir(), "panel-startup-"));
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert(address && typeof address !== "string");
const serverUrl = `http://127.0.0.1:${address.port}/`;
const context = await webkit.launchPersistentContext(profile, { headless: true });

try {
  let page = await context.newPage();
  await page.goto(serverUrl);
  await page.locator("main").waitFor();
  await page.close();
  deployed = true;
  requests.length = 0;

  // The old shell's first navigation: still consumes the fresh cached OLD
  // HTML even though the server now sends no-cache. A new page excludes BFCache.
  page = await context.newPage();
  await page.goto(serverUrl);
  assert.equal(await page.locator("main").count(), 0, "old entry must reproduce a blank boot");
  assert(!requests.includes("/"), "WebKit must reuse historical HTML without revalidation");
  assert(requests.includes("/assets/old.js"), "stale HTML must request the removed chunk");
  await page.close();

  // Every new launch must render on generation ZERO, before the 15s recovery
  // deadline. No loading overlay and no timeout change participates in this.
  for (const launchedAt of [100, 200]) {
    page = await context.newPage();
    const reports: unknown[] = [];
    await page.exposeFunction("recordBoot", (data: string) => reports.push(JSON.parse(data)));
    await page.addInitScript(() => {
      Object.assign(window, {
        ReactNativeWebView: {
          postMessage: (data: string) =>
            (window as unknown as { recordBoot: (value: string) => void }).recordBoot(data),
        },
      });
    });
    const start = performance.now();
    await page.goto(bootUrl(serverUrl, 0, launchedAt));
    await page.evaluate(bootReportScript);
    await page.locator("main").waitFor({ timeout: 5_000 });
    assert(performance.now() - start < RENDER_DEADLINE_MS);
    assert.deepEqual(reports, [{ channel: "control-center-shell", rendered: true }]);
    assert(requests.includes(`/?shellBoot=${launchedAt}-0`));
    assert.equal(
      requests.filter((path) => path === "/assets/current.js").length,
      1,
      "cache-busting HTML must NOT disable immutable asset caching across launches",
    );
    process.stdout.write(
      `Launch ${launchedAt}: rendered on first navigation in ${Math.round(performance.now() - start)}ms\n`,
    );
    await page.close();
  }
  process.stdout.write(
    "PASS: stale HTML reproduced; both cold navigations bypass it; current chunk reused.\n",
  );
} finally {
  await context.close();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await rm(profile, { recursive: true, force: true });
}
