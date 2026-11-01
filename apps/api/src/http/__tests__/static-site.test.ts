import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { boundedRequest, serveStaticSite } from "../static-site";

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "www-sites-"));
  for (const site of ["web", "manage"]) {
    const dist = join(root, "apps", site, "dist");
    await mkdir(join(dist, "assets"), { recursive: true });
    await writeFile(join(dist, "index.html"), `<html>${site}</html>`);
    await writeFile(join(dist, "assets", "bundle.js"), `const site = '${site}'`);
  }
  await writeFile(join(root, "secret"), "outside the bundle");
  await symlink(join(root, "secret"), join(root, "apps/web/dist/assets/leak.js"));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});
const serve = (path: string, host = "app.worldwidewebb.co", method = "GET") =>
  serveStaticSite(
    new Request(`https://${host}${path}`, { method }),
    root,
    "manage.worldwidewebb.co",
  );

describe("static sites", () => {
  it("routes by hostname and revalidates HTML on every SPA navigation", async () => {
    for (const [host, site] of [
      ["app.worldwidewebb.co", "web"],
      ["manage.worldwidewebb.co", "manage"],
    ]) {
      const res = await serve("/tools", host);
      expect(await res.text()).toBe(`<html>${site}</html>`);
      expect(res.headers.get("cache-control")).toBe("no-cache");
      expect(res.headers.get("x-frame-options")).toBe(site === "manage" ? "DENY" : null);
    }
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
