import { describe, expect, it } from "vitest";

import {
  getInteractionSession,
  type InteractionSessionEvent,
  summarise,
} from "./interaction-session-service";

const SID = "isn_aaaaaaaaaaaa";

function ev(ts: number, msg: string, data: Record<string, unknown> = {}): InteractionSessionEvent {
  return { ts, idx: Number(data.idx ?? 0), msg, data: { interactionSessionId: SID, ...data } };
}

describe("interaction-session summarise", () => {
  it("derives a completed session from its start/end brackets", () => {
    const events = [
      ev(1000, "session/start", { idx: 0 }),
      ev(2000, "tile/tap", { idx: 1, target: "tile_clock" }),
      ev(5000, "session/end", { idx: 2, reason: "idle-dim", events: 1, durationMs: 4000 }),
    ];
    expect(summarise(SID, events, "wall-panel", ["2026/07/18/1000-0.jpg"])).toEqual({
      id: SID,
      startedAt: 1000,
      endedAt: 5000,
      durationMs: 4000,
      eventCount: 1,
      endReason: "idle-dim",
      deviceName: "wall-panel",
      photoPaths: ["2026/07/18/1000-0.jpg"],
    });
  });

  it("reports a live session as unended rather than inventing an end", () => {
    const events = [
      ev(1000, "session/start", { idx: 0 }),
      ev(2000, "tile/tap", { idx: 1, target: "tile_clock" }),
      ev(3000, "modal/open", { idx: 2, target: "modal.Climate" }),
    ];
    const s = summarise(SID, events, "wall-panel", []);
    expect(s.endedAt).toBeNull();
    expect(s.durationMs).toBeNull();
    expect(s.endReason).toBeNull();
    // No session/end to trust, so the count is derived from what shipped ,
    // excluding the start/end brackets themselves.
    expect(s.eventCount).toBe(2);
  });

  it("prefers the panel's own event count over the shipped-row count", () => {
    // Offline gap: only the brackets shipped, the taps between them are still
    // in the device's queue. The end entry's `events` is the truth.
    const events = [
      ev(1000, "session/start", { idx: 0 }),
      ev(9000, "session/end", { idx: 7, reason: "timeout", events: 6, durationMs: 8000 }),
    ];
    expect(summarise(SID, events, "wall-panel", []).eventCount).toBe(6);
  });

  it("handles an empty transcript without inventing timestamps", () => {
    const s = summarise(SID, [], "wall-panel", []);
    expect(s.startedAt).toBe(0);
    expect(s.endedAt).toBeNull();
    expect(s.eventCount).toBe(0);
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
