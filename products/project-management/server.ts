/**
 * beads-ui backend.
 *
 * Serves the Claude Design handoff bundle (the worldwidewebb "DC" prototype in
 * ./public) verbatim, and feeds it LIVE beads data. It shells out to the `bd`
 * CLI (--json) to read the project's issues, keeps an in-memory snapshot, and
 * periodically runs `bd dolt pull` so the snapshot tracks the remote. Read-only:
 * it never writes issues. /api/board-data returns the issues mapped into the
 * exact shape the prototype consumes (see map.ts).
 */
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runProjectManagementMigrations } from "./db/migrate";
import { mapIssues, type RawIssue } from "./map";
import { defaultRuntimeLogRoot } from "./temporal/command-activities";
import { workflowDashboardForIssues } from "./workflow";
import {
  createTemporalWorkflowControlClient,
  isWorkflowControlAction,
  type WorkflowControlClient,
} from "./workflow-control";
import { workflowMetricsForIssues } from "./workflow-metrics";

export type Snapshot = {
  issues: RawIssue[];
  lastSyncAt: string | null;
  lastFetchAt: string | null;
  lastError: string | null;
  syncing: boolean;
};

export type ServerOptions = {
  port: number;
  repoRoot: string;
  syncIntervalMs: number;
  publicDir: string;
  workflowLogRoots: readonly string[];
  runMigrations: () => Promise<void>;
};

export function defaultServerOptions(): ServerOptions {
  return {
    port: Number(process.env.BEADS_UI_PORT ?? 8791),
    // Run bd against the repo root so it resolves this project regardless of launch cwd.
    repoRoot: join(import.meta.dir, "..", ".."),
    syncIntervalMs: Number(process.env.BEADS_UI_SYNC_MS ?? 30_000),
    publicDir: join(import.meta.dir, "public"),
    workflowLogRoots: [
      defaultRuntimeLogRoot(),
      join(import.meta.dir, "..", "..", ".tickets", "logs"),
    ],
    runMigrations: runProjectManagementMigrations,
  };
}

export function initialSnapshot(): Snapshot {
  return {
    issues: [],
    lastSyncAt: null,
    lastFetchAt: null,
    lastError: null,
    syncing: false,
  };
}

export async function runBdCommand(
  cmd: readonly string[],
  repoRoot: string,
  timeoutMs = 60_000,
): Promise<string> {
  const proc = Bun.spawn([...cmd], {
    cwd: repoRoot,
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

export async function fetchIssues(snapshot: Snapshot, repoRoot: string): Promise<void> {
  const out = await runBdCommand(
    ["bd", "list", "--all", "--json", "-n", "0", "--no-pager"],
    repoRoot,
  );
  const listedIssues = parseRawIssues(out);
  snapshot.issues = await fetchIssueDetails(listedIssues, repoRoot);
  snapshot.lastFetchAt = new Date().toISOString();
}

async function fetchIssueDetails(listedIssues: RawIssue[], repoRoot: string): Promise<RawIssue[]> {
  if (listedIssues.length === 0) return [];
  try {
    const out = await runBdCommand(
      ["bd", "show", ...listedIssues.map((issue) => issue.id), "--json", "--include-comments"],
      repoRoot,
      90_000,
    );
    const detailedIssues = parseRawIssues(out);
    return detailedIssues.length > 0 ? detailedIssues : listedIssues;
  } catch {
    return listedIssues;
  }
}

function parseRawIssues(stdout: string): RawIssue[] {
  const parsed: unknown = JSON.parse(stdout);
  return Array.isArray(parsed) ? (parsed as RawIssue[]) : [];
}

export async function syncFromRemote(snapshot: Snapshot, repoRoot: string): Promise<void> {
  if (snapshot.syncing) return;
  snapshot.syncing = true;
  try {
    // Pull remote dolt changes (read direction only; we never push from here).
    await runBdCommand(["bd", "dolt", "pull"], repoRoot, 90_000).catch((e: unknown) => {
      snapshot.lastError = `pull: ${String(e)}`;
    });
    await fetchIssues(snapshot, repoRoot);
    snapshot.lastSyncAt = new Date().toISOString();
    if (snapshot.lastError?.startsWith("pull:") !== true) snapshot.lastError = null;
  } catch (e) {
    snapshot.lastError = String(e);
  } finally {
    snapshot.syncing = false;
  }
}

export function json(data: unknown, status = 200): Response {
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

export async function serveStatic(pathname: string, publicDir: string): Promise<Response> {
  // "/" serves the prototype entry.
  const rel = pathname === "/" ? "/Beads.dc.html" : decodeURIComponent(pathname);
  const file = Bun.file(join(publicDir, rel));
  if (!(await file.exists())) return new Response("not found", { status: 404 });
  const ext = rel.slice(rel.lastIndexOf("."));
  return new Response(file, {
    headers: { "content-type": MIME[ext] ?? "application/octet-stream" },
  });
}

export type RequestHandlerOptions = {
  snapshot: Snapshot;
  workflowControlClient: WorkflowControlClient;
  workflowLogRoots: readonly string[];
  syncFromRemote: () => Promise<void>;
  serveStatic: (pathname: string) => Promise<Response>;
};

export function createRequestHandler(
  options: RequestHandlerOptions,
): (req: Request) => Promise<Response> {
  return async (req) => {
    const url = new URL(req.url);
    const p = url.pathname;

    if (p === "/api/board-data") {
      const issues = mapIssues(options.snapshot.issues);
      return json({
        issues,
        workflow: workflowDashboardForIssues(issues),
        metrics: workflowMetricsForIssues(issues),
        meta: {
          lastSyncAt: options.snapshot.lastSyncAt,
          lastFetchAt: options.snapshot.lastFetchAt,
          lastError: options.snapshot.lastError,
          syncing: options.snapshot.syncing,
          count: options.snapshot.issues.length,
        },
      });
    }

    if (p === "/api/sync" && req.method === "POST") {
      await options.syncFromRemote();
      return json({
        ok: true,
        lastSyncAt: options.snapshot.lastSyncAt,
        error: options.snapshot.lastError,
      });
    }

    if (p === "/api/workflow-control" && req.method === "POST") {
      return handleWorkflowControl(req, options.workflowControlClient);
    }

    if (p === "/api/workflow-log") {
      return serveWorkflowLog(url.searchParams.get("path"), options.workflowLogRoots);
    }

    if (p.startsWith("/api/")) return json({ error: "not found" }, 404);

    return options.serveStatic(p);
  };
}

async function serveWorkflowLog(
  path: string | null,
  workflowLogRoots: readonly string[],
): Promise<Response> {
  if (!path) return new Response("path is required", { status: 400 });
  const resolvedPath = resolve(path);
  const allowed = workflowLogRoots.map((root) => resolve(root));
  if (!allowed.some((root) => resolvedPath === root || resolvedPath.startsWith(`${root}/`))) {
    return new Response("log path is outside allowed roots", { status: 403 });
  }

  try {
    const text = await readFile(resolvedPath, "utf8");
    return new Response(text, { headers: { "content-type": "text/plain; charset=utf-8" } });
  } catch {
    return new Response("not found", { status: 404 });
  }
}

async function handleWorkflowControl(
  req: Request,
  workflowControlClient: WorkflowControlClient,
): Promise<Response> {
  const body = await parseJsonObject(req);
  const ticketId = stringBodyField(body, "ticketId");
  const action = stringBodyField(body, "action");
  const reason = stringBodyField(body, "reason", false);

  if (!ticketId || !action || !isWorkflowControlAction(action)) {
    return json({ error: "ticketId and valid action are required" }, 400);
  }

  const result = await workflowControlClient.signalTicketWorkflow({ ticketId, action, reason });
  return json({ ok: true, result });
}

async function parseJsonObject(req: Request): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await req.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function stringBodyField(
  body: Record<string, unknown>,
  key: string,
  required = true,
): string | undefined {
  const value = body[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed) return trimmed;
  return required ? undefined : "";
}

export async function startServer(options = defaultServerOptions()): Promise<void> {
  await options.runMigrations();

  const snapshot = initialSnapshot();
  const handler = createRequestHandler({
    snapshot,
    workflowControlClient: createTemporalWorkflowControlClient(),
    workflowLogRoots: options.workflowLogRoots,
    syncFromRemote: () => syncFromRemote(snapshot, options.repoRoot),
    serveStatic: (pathname) => serveStatic(pathname, options.publicDir),
  });

  Bun.serve({
    port: options.port,
    fetch: handler,
  });

  console.warn(`[beads-ui] http://127.0.0.1:${options.port}  (repo: ${options.repoRoot})`);

  await syncFromRemote(snapshot, options.repoRoot);
  setInterval(() => void syncFromRemote(snapshot, options.repoRoot), options.syncIntervalMs);
}

if (import.meta.main) await startServer();
