import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetInteractionSessionForTests,
  endInteractionSession,
  interaction,
} from "../log/interaction";
import { getTail } from "../log/logger";

/** The ui-channel entries emitted since the given tail length. */
function uiSince(from: number) {
  return getTail()
    .slice(from)
    .filter((e) => e.source === "ui");
}

function sessionIdOf(entry: { data?: unknown }): string {
  return (entry.data as { interactionSessionId: string }).interactionSessionId;
}

describe("interaction logging", () => {
  let mark = 0;

  beforeEach(() => {
    vi.useFakeTimers();
    __resetInteractionSessionForTests();
    mark = getTail().length;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits a typed entry on the ui channel", () => {
    interaction("tile", "tap", "tile_climate", { label: "Climate" });
    const [entry] = uiSince(mark).filter((e) => e.msg === "tile/tap");
    expect(entry.level).toBe("info");
    expect(entry.data).toMatchObject({ target: "tile_climate", label: "Climate", idx: 1 });
  });

  it("opens a session on the first interaction and indexes events monotonically", () => {
    interaction("tile", "tap", "tile_clock");
    interaction("modal", "open", "modal.Settings");
    const entries = uiSince(mark);
    expect(entries.map((e) => e.msg)).toEqual(["session/start", "tile/tap", "modal/open"]);
    // One session id across the whole visit, with a strictly increasing index.
    const ids = new Set(entries.map(sessionIdOf));
    expect(ids.size).toBe(1);
    expect(entries.map((e) => (e.data as { idx: number }).idx)).toEqual([0, 1, 2]);
  });

  it("closes the session after the idle window, recording its shape", () => {
    interaction("tile", "tap", "tile_clock");
    vi.advanceTimersByTime(60_000);
    const [end] = uiSince(mark).filter((e) => e.msg === "session/end");
    expect(end.data).toMatchObject({ reason: "timeout", events: 1 });
  });

  it("resumes the same session inside the grace window", () => {
    interaction("tile", "tap", "tile_clock");
    const first = sessionIdOf(uiSince(mark)[0]);
    endInteractionSession("idle-dim");

    vi.advanceTimersByTime(10_000);
    interaction("tile", "tap", "tile_weather");
    const resumed = uiSince(mark).filter((e) => e.msg === "tile/tap")[1];
    expect(sessionIdOf(resumed)).toBe(first);
    // A resume must not re-announce a start , one visit, one session/start.
    expect(uiSince(mark).filter((e) => e.msg === "session/start")).toHaveLength(1);
  });

  it("starts a fresh session once the grace window has passed", () => {
    interaction("tile", "tap", "tile_clock");
    const first = sessionIdOf(uiSince(mark)[0]);
    endInteractionSession("idle-dim");

    vi.advanceTimersByTime(31_000);
    interaction("tile", "tap", "tile_weather");
    const next = uiSince(mark).filter((e) => e.msg === "tile/tap")[1];
    expect(sessionIdOf(next)).not.toBe(first);
  });

  it("ending with no live session is a no-op", () => {
    endInteractionSession("idle-reset");
    expect(uiSince(mark)).toHaveLength(0);
  });
});
