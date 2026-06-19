import { describe, expect, it } from "vitest";
import { createRequestHandler, initialSnapshot, type Snapshot } from "./server";

describe("createRequestHandler", () => {
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
      syncFromRemote: async () => {},
      serveStatic: async () => new Response("static"),
    });

    const response = await handler(new Request("http://127.0.0.1/api/board-data"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      issues: [expect.objectContaining({ id: "www-a", status: "ready" })],
      workflow: {
        activeRuns: [],
        columns: [
          { id: "ready", label: "ticket-ready", title: "Builder", tickets: [] },
          { id: "review", label: "ticket-review", title: "Review", tickets: [] },
          { id: "verified", label: "ticket-verified", title: "Verified", tickets: [] },
          { id: "retry", label: "ticket-retry", title: "Retry", tickets: [] },
          { id: "human", label: "ticket-human", title: "Human", tickets: [] },
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
});
