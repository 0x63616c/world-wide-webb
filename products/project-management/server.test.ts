import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRequestHandler, initialSnapshot, type Snapshot } from "./server";

describe("createRequestHandler", () => {
  it("serves the app entrypoint HTML for root requests", async () => {
    const handler = createRequestHandler({
      snapshot: initialSnapshot(),
      workflowLogRoots: [],
      syncFromRemote: async () => {},
      serveStatic: async () =>
        new Response(await readFile(new URL("./public/Beads.dc.html", import.meta.url), "utf8")),
    });

    const response = await handler(new Request("http://127.0.0.1/"));

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain("<title>Project Management UI</title>");
  });

  it("serves mapped board data from the current snapshot", async () => {
    const snapshot: Snapshot = {
      ...initialSnapshot(),
      issues: [
        {
          id: "www-a",
          title: "Ready task",
          status: "open",
          priority: 2,
          issue_type: "task",
        },
      ],
      lastFetchAt: "2026-06-01T12:00:00.000Z",
    };
    const handler = createRequestHandler({
      snapshot,
      workflowLogRoots: [],
      syncFromRemote: async () => {},
      serveStatic: async () => new Response("static"),
    });

    const response = await handler(new Request("http://127.0.0.1/api/board-data"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      issues: [expect.objectContaining({ id: "www-a", status: "ready" })],
      metrics: expect.objectContaining({
        counts: expect.objectContaining({ started: 0, closed: 0 }),
        durations: expect.objectContaining({ samples: 0 }),
      }),
      workflow: {
        activeRuns: [],
        columns: [
          { id: "backlog", label: "ticket-backlog", title: "Backlog", tickets: [] },
          { id: "queued", label: "ticket-queued", title: "Queued", tickets: [] },
          { id: "ready", label: "ticket-ready", title: "Builder", tickets: [] },
          { id: "review", label: "ticket-review", title: "Review", tickets: [] },
          { id: "verified", label: "ticket-verified", title: "Verified", tickets: [] },
          { id: "human", label: "ticket-human", title: "Human", tickets: [] },
          { id: "shipped", label: "ticket-shipped", title: "Shipped", tickets: [] },
        ],
      },
      meta: {
        lastSyncAt: null,
        lastFetchAt: "2026-06-01T12:00:00.000Z",
        lastError: null,
        syncing: false,
        count: 1,
      },
    });
  });

  it("triggers sync only for POST /api/sync", async () => {
    let syncCount = 0;
    const snapshot = initialSnapshot();
    const handler = createRequestHandler({
      snapshot,
      workflowLogRoots: [],
      syncFromRemote: async () => {
        syncCount += 1;
        snapshot.lastSyncAt = "2026-06-01T12:00:00.000Z";
      },
      serveStatic: async () => new Response("static"),
    });

    const getResponse = await handler(new Request("http://127.0.0.1/api/sync"));
    const postResponse = await handler(
      new Request("http://127.0.0.1/api/sync", { method: "POST" }),
    );

    expect(getResponse.status).toBe(404);
    expect(postResponse.status).toBe(200);
    expect(syncCount).toBe(1);
    await expect(postResponse.json()).resolves.toEqual({
      ok: true,
      lastSyncAt: "2026-06-01T12:00:00.000Z",
      error: null,
    });
  });

  it("does not expose manual workflow control endpoints", async () => {
    const handler = createRequestHandler({
      snapshot: initialSnapshot(),
      workflowLogRoots: [],
      syncFromRemote: async () => {},
      serveStatic: async () => new Response("static"),
    });

    const response = await handler(
      new Request("http://127.0.0.1/api/workflow-control", {
        method: "POST",
        body: JSON.stringify({ ticketId: "www-3agy.14", action: "retry" }),
      }),
    );

    expect(response.status).toBe(404);
  });

  it("serves workflow logs only from configured log roots", async () => {
    const logRoot = await mkdtemp(join(tmpdir(), "project-management-logs-"));
    const logPath = join(logRoot, "ticket_www-3agy.14_build_1.stdout.log");
    await writeFile(logPath, "builder output");
    const handler = createRequestHandler({
      snapshot: initialSnapshot(),
      workflowLogRoots: [logRoot],
      syncFromRemote: async () => {},
      serveStatic: async () => new Response("static"),
    });

    const ok = await handler(
      new Request(`http://127.0.0.1/api/workflow-log?path=${encodeURIComponent(logPath)}`),
    );
    const outside = await handler(
      new Request("http://127.0.0.1/api/workflow-log?path=/etc/passwd"),
    );

    expect(ok.status).toBe(200);
    await expect(ok.text()).resolves.toBe("builder output");
    expect(outside.status).toBe(403);
  });
});
