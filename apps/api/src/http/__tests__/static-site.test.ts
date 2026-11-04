import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { boundedRequest, serveStaticSite } from "../static-site";

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "www-sites-"));
  const dist = join(root, "apps/web/dist");
  await mkdir(join(dist, "assets"), { recursive: true });
  await writeFile(join(dist, "index.html"), "<html>web</html>");
  await writeFile(join(dist, "assets", "bundle.js"), "const site = 'web'");
  await writeFile(join(root, "secret"), "outside the bundle");
  await symlink(join(root, "secret"), join(root, "apps/web/dist/assets/leak.js"));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});
const serve = (path: string, host = "app.worldwidewebb.co", method = "GET") =>
  serveStaticSite(new Request(`https://${host}${path}`, { method }), root);

describe("static sites", () => {
  it("serves a symlinked deployment root while rejecting escaping assets", async () => {
    const alias = join(root, "alias");
    await symlink(root, alias);
    const request = (path: string) =>
      serveStaticSite(new Request(`http://localhost${path}`), alias);
    expect(await (await request("/")).text()).toBe("<html>web</html>");
    expect((await request("/assets/leak.js")).status).toBe(404);
  });
  it("revalidates HTML on every SPA navigation", async () => {
    const res = await serve("/settings");
    expect(await res.text()).toBe("<html>web</html>");
    expect(res.headers.get("cache-control")).toBe("no-cache");
  });
  it("serves immutable assets with the correct MIME and supports HEAD", async () => {
    const res = await serve("/assets/bundle.js");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(res.headers.get("content-type")).toBe("application/javascript");
    expect(await res.text()).toContain("web");
    const head = await serve("/assets/bundle.js", undefined, "HEAD");
    expect(head.headers.get("content-length")).toBe(res.headers.get("content-length"));
    expect(await head.text()).toBe("");
  });
  it("returns real 404s for missing assets, maps, backend paths and traversal", async () => {
    for (const path of [
      "/assets/old.js",
      "/maps/a",
      "/api/missing",
      "/trpc/missing",
      "/media/missing",
      "/metrics",
      "/%2e%2e%2fsecret",
      "/assets/leak.js",
      "/.env",
      "/%zz",
    ]) {
      expect((await serve(path)).status, path).toBe(404);
    }
    expect((await serve("/", undefined, "POST")).status).toBe(404);
  });
});

describe("route body limits", () => {
  it("rejects over-limit requests, including streams without Content-Length", async () => {
    for (const [path, limit] of [
      ["alarms", 8192],
      ["notifications", 32768],
    ] as const) {
      const req = new Request(`http://localhost/api/${path}`, {
        method: "POST",
        body: "x".repeat(limit + 1),
      });
      const res = await boundedRequest(req);
      expect(res).toBeInstanceOf(Response);
      expect((res as Response).status).toBe(413);
      const chunked = new Request(`http://localhost/api/${path}`, {
        method: "POST",
        body: new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(limit + 1));
            c.close();
          },
        }),
        duplex: "half",
      } as RequestInit);
      expect(((await boundedRequest(chunked)) as Response).status).toBe(413);
    }
  });
  it("preserves accepted request bytes and leaves SSE GETs alone", async () => {
    const req = new Request("http://localhost/api/alarms", {
      method: "POST",
      body: '{"name":"alarm"}',
    });
    expect(await (await boundedRequest(req)).text()).toBe('{"name":"alarm"}');
    const stream = new Request("http://localhost/api/notifications/stream");
    expect(await boundedRequest(stream)).toBe(stream);
  });
});
