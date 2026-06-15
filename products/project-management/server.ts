/**
 * beads-ui backend.
 *
 * Serves the React SPA (./dist in prod; Vite dev server proxies /api here in dev)
 * and feeds it live beads data. Shells out to the `bd` CLI, keeps an in-memory
 * snapshot, and periodically runs `bd dolt pull`. Read-only: never writes issues.
 */
import { join } from "node:path";
import { mapIssues, type RawIssue } from "./map";

const PORT = Number(process.env.BEADS_UI_PORT ?? 8791);
const REPO_ROOT = join(import.meta.dir, "..", "..");
const SYNC_INTERVAL_MS = Number(process.env.BEADS_UI_SYNC_MS ?? 30_000);
const DIST = join(import.meta.dir, "dist");

type Snapshot = {
  issues: RawIssue[];
  lastSyncAt: string | null;
  lastFetchAt: string | null;
  lastError: string | null;
  syncing: boolean;
};

const snapshot: Snapshot = {
  issues: [],
  lastSyncAt: null,
  lastFetchAt: null,
  lastError: null,
  syncing: false,
};

async function run(cmd: string[], timeoutMs = 60_000): Promise<string> {
  const proc = Bun.spawn(cmd, {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  if (exit !== 0) {
    throw new Error(`${cmd.join(" ")} exited ${exit}: ${stderr.trim() || stdout.trim()}`);
  }
  return stdout;
}

async function fetchIssues(): Promise<void> {
  const out = await run(["bd", "list", "--all", "--json", "-n", "0", "--no-pager"]);
  snapshot.issues = JSON.parse(out) as RawIssue[];
  snapshot.lastFetchAt = new Date().toISOString();
}

async function syncFromRemote(): Promise<void> {
  if (snapshot.syncing) return;
  snapshot.syncing = true;
  try {
    await run(["bd", "dolt", "pull"], 90_000).catch((e) => {
      snapshot.lastError = `pull: ${String(e)}`;
    });
    await fetchIssues();
    snapshot.lastSyncAt = new Date().toISOString();
    if (snapshot.lastError?.startsWith("pull:") !== true) snapshot.lastError = null;
  } catch (e) {
    snapshot.lastError = String(e);
  } finally {
    snapshot.syncing = false;
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

async function serveStatic(pathname: string): Promise<Response> {
  const rel = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const file = Bun.file(join(DIST, rel));
  if (await file.exists()) {
    const ext = rel.slice(rel.lastIndexOf("."));
    return new Response(file, {
      headers: { "content-type": MIME[ext] ?? "application/octet-stream" },
    });
  }
  // SPA fallback: let React Router handle unknown paths
  const index = Bun.file(join(DIST, "index.html"));
  if (await index.exists()) {
    return new Response(index, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  return new Response("not found", { status: 404 });
}

interface RawComment {
  id?: string;
  body?: string;
  content?: string;
  author?: string;
  created_by?: string;
  created_at?: string;
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const p = url.pathname;

    if (p === "/api/board-data") {
      return json({
        issues: mapIssues(snapshot.issues),
        meta: {
          lastSyncAt: snapshot.lastSyncAt,
          lastFetchAt: snapshot.lastFetchAt,
          lastError: snapshot.lastError,
          syncing: snapshot.syncing,
          count: snapshot.issues.length,
        },
      });
    }

    if (p === "/api/sync" && req.method === "POST") {
      await syncFromRemote();
      return json({ ok: true, lastSyncAt: snapshot.lastSyncAt, error: snapshot.lastError });
    }

    const commentsMatch = /^\/api\/comments\/([^/]+)$/.exec(p);
    if (commentsMatch) {
      const id = decodeURIComponent(commentsMatch[1]);
      try {
        const out = await run(["bd", "comments", id, "--json"], 15_000);
        const raw = JSON.parse(out) as RawComment[] | { comments?: RawComment[] };
        const list: RawComment[] = Array.isArray(raw) ? raw : (raw.comments ?? []);
        const mapped = list.map((c, i) => ({
          id: c.id ?? String(i),
          body: c.body ?? c.content ?? "",
          author: c.author ?? c.created_by ?? "unknown",
          created_at: c.created_at ?? new Date().toISOString(),
        }));
        return json(mapped);
      } catch {
        return json([]);
      }
    }

    if (p.startsWith("/api/")) return json({ error: "not found" }, 404);

    return serveStatic(p);
  },
});

console.log(`[beads-ui] http://127.0.0.1:${PORT}  (repo: ${REPO_ROOT})`);

await syncFromRemote();
setInterval(syncFromRemote, SYNC_INTERVAL_MS);
