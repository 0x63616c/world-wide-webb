import { describe, expect, it } from "vitest";

import {
  computeDigest,
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
      digest: "Clock",
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

describe("computeDigest", () => {
  it("names the notable subjects touched, in first-seen order", () => {
    const events = [
      ev(1000, "session/start", { idx: 0 }),
      ev(1500, "session/wake", { idx: 1, target: "panel" }),
      ev(2000, "tile/tap", { idx: 2, target: "tile_climate", label: "Climate" }),
      ev(2500, "modal/open", { idx: 3, target: "modal.Climate" }),
      ev(3000, "control/change", { idx: 4, target: "control.lamp.desk", brightness: 60 }),
      ev(4000, "settings/change", { idx: 5, target: "settings.idleDimLevel", from: 0.2, to: 0.3 }),
      ev(5000, "session/end", { idx: 6, reason: "idle-dim", events: 4, durationMs: 4000 }),
    ];
    // Brackets, wake, and the modal open are noise; the tile/control/setting are
    // the notable subjects, deduped and in order.
    expect(computeDigest(events)).toBe("Climate · Desk lamp · Settings");
  });

  it("collapses past the cap into a +N more tail", () => {
    const events = [
      ev(1000, "tile/tap", { idx: 1, target: "tile_climate", label: "Climate" }),
      ev(1100, "tile/tap", { idx: 2, target: "tile_media", label: "Media" }),
      ev(1200, "control/change", { idx: 3, target: "control.lamp.desk", brightness: 60 }),
      ev(1300, "settings/change", { idx: 4, target: "settings.theme", from: "a", to: "b" }),
    ];
    expect(computeDigest(events)).toBe("Climate · Media · Desk lamp · +1 more");
  });

  it("dedupes repeated subjects", () => {
    const events = [
      ev(1000, "tile/tap", { idx: 1, target: "tile_climate", label: "Climate" }),
      ev(1100, "tile/tap", { idx: 2, target: "tile_climate", label: "Climate" }),
    ];
    expect(computeDigest(events)).toBe("Climate");
  });

  it("is null when nothing notable happened", () => {
    const events = [
      ev(1000, "session/start", { idx: 0 }),
      ev(1500, "session/wake", { idx: 1, target: "panel" }),
      ev(2000, "nav/jump", { idx: 2, target: "minimap" }),
      ev(3000, "session/end", { idx: 3, reason: "timeout", events: 1, durationMs: 2000 }),
    ];
    expect(computeDigest(events)).toBeNull();
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
