import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import * as schema from "./schema";
import { getInteractionSession, listInteractionSessions, summarise } from "./service";

const SID = "isn_aaaaaaaaaaaa";

// The transcript-derived assertions (duration, end reason, event count, digest)
// were removed with the frontend_log pipeline they read (The Simplification §2)
// , not skipped. What is left is what wake_photo can actually say about a visit.
describe("interaction-session summarise", () => {
  it("derives a session from its burst: id, start, device, frames", () => {
    expect(summarise(SID, 1000, "wall-panel", ["2026-07-18T12-40-00.000Z-0.jpg"])).toEqual({
      id: SID,
      startedAt: 1000,
      endedAt: null,
      durationMs: null,
      eventCount: 0,
      endReason: null,
      deviceName: "wall-panel",
      photoPaths: ["2026-07-18T12-40-00.000Z-0.jpg"],
      digest: null,
    });
  });

  it("reports the unknowable fields as null rather than inventing them", () => {
    const s = summarise(SID, 1000, "wall-panel", []);
    expect(s.endedAt).toBeNull();
    expect(s.durationMs).toBeNull();
    expect(s.endReason).toBeNull();
    expect(s.digest).toBeNull();
  });
});

describe("listInteractionSessions", () => {
  it.each([
    "2026-07-18 12:40:00.123+00",
    "2026-07-18 05:40:00.123-07",
  ])("maps the aggregate timestamp %s before summarising the session", async (timestamp) => {
    const path = "2026-07-18T12-40-00.123Z-0.jpg";
    // Supply raw node-postgres rows so the real Drizzle selection decoder
    // runs before the grouping result reaches summarise.
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [[SID, timestamp, "wall-panel"]] })
        .mockResolvedValueOnce({ rows: [[path]] }),
    };
    const db = drizzle(client as unknown as Pool, { schema });

    expect(await listInteractionSessions(db)).toEqual([
      summarise(SID, Date.UTC(2026, 6, 18, 12, 40, 0, 123), "wall-panel", [path]),
    ]);
    expect(client.query).toHaveBeenCalledTimes(2);
  });
});

describe("getInteractionSession", () => {
  it("returns null for an unknown session", async () => {
    // Universal-empty mock: every select chain resolves to no rows, which is
    // exactly what an unknown id produces.
    const emptyChain = {
      from: () => emptyChain,
      where: () => emptyChain,
      orderBy: () => Promise.resolve([]),
      limit: () => Promise.resolve([]),
    };
    // biome-ignore lint: test harness stands in for NodePgDatabase<typeof schema>
    const db = { select: () => emptyChain } as any;

    expect(await getInteractionSession(db, "isn_zzzzzzzzzzzz")).toBeNull();
  });
});
