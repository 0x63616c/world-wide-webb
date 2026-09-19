import { describe, expect, it } from "vitest";

import { getInteractionSession, summarise } from "./service";

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
