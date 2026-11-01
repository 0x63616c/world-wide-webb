import { readFile, realpath } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".jpg": "image/jpeg",
};

/** Same-origin static sites; missing immutable chunks must never return HTML. */
export async function serveStaticSite(req: Request, root: string, manageHost: string) {
  const url = new URL(req.url);
  const manage = url.hostname === manageHost;
  const headers = new Headers({ "X-Content-Type-Options": "nosniff" });
  if (manage) headers.set("X-Frame-Options", "DENY");
  const missing = () => new Response("Not Found", { status: 404, headers });
  if (req.method !== "GET" && req.method !== "HEAD") return missing();
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return missing();
  }
  if (
    path.split("/").some((part) => part.startsWith(".")) ||
    path.includes("\\") ||
    path.includes("\0")
  )
    return missing();
  if (/^\/(maps|api|trpc|media|metrics)(\/|$)/.test(path)) return missing();
  const siteRoot = resolve(root, "apps", manage ? "manage" : "web", "dist");
  const immutable = path.startsWith("/assets/");
  const requested = resolve(siteRoot, `.${path}`);
  if (!requested.startsWith(siteRoot + sep)) return path === "/" ? entry() : missing();

  async function send(file: string, cache: string): Promise<Response> {
    // Resolve symlinks too: no file outside the bundle is ever served.
    const actual = await realpath(file);
    if (!actual.startsWith(siteRoot + sep)) return missing();
    const bytes = await readFile(actual);
    headers.set("Cache-Control", cache);
    headers.set("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
    headers.set("Content-Length", String(bytes.byteLength));
    return new Response(req.method === "HEAD" ? null : new Uint8Array(bytes), { headers });
  }
  async function entry(): Promise<Response> {
    try {
      return await send(resolve(siteRoot, "index.html"), "no-cache");
    } catch {
      return missing();
    }
  }
  try {
    return await send(requested, immutable ? "public, max-age=31536000, immutable" : "no-cache");
  } catch {
    return immutable ? missing() : entry();
  }
}

/** Enforce the nginx per-route caps even for chunked requests without a length. */
export async function boundedRequest(req: Request): Promise<Request | Response> {
  const path = new URL(req.url).pathname;
  const limit = path.startsWith("/api/alarms")
    ? 8192
    : path.startsWith("/api/notifications")
      ? 32768
      : undefined;
  if (!limit || !req.body) return req;
  if (Number(req.headers.get("content-length")) > limit)
    return new Response("Payload Too Large", { status: 413 });
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return new Response("Payload Too Large", { status: 413 });
    }
    chunks.push(value);
  }
  return new Request(req, { body: Buffer.concat(chunks) });
}
