/**
 * Timer store contract: absolute deadlines, the ring-until-stopped nag, and ,
 * the case this repo hits on every push to main , deploy-reload boot-resume.
 * Fake wall-clock throughout; lib/sound is mocked so cue ASSERTIONS replace
 * cue audio.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMemoryLocalStorage } from "./memory-local-storage";

const playCue = vi.hoisted(() => vi.fn());
const warmAudio = vi.hoisted(() => vi.fn());
vi.mock("../../sound", () => ({ playCue, warmAudio }));

type TimerStore = typeof import("../timer-store");

const BASE = new Date(2026, 6, 20, 10, 0, 0).getTime();
const STORAGE_KEY = "cc-timers-v1";

let store: TimerStore;

/** Import a FRESH module instance (module reset = an app reload). */
async function freshStore(): Promise<TimerStore> {
  vi.resetModules();
  return await import("../timer-store");
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(BASE);
  installMemoryLocalStorage();
  playCue.mockClear();
  warmAudio.mockClear();
  store = await freshStore();
});

afterEach(() => {
  // Releases the ticker handle so no stale interval survives into the next
  // module instance (which would double-count cues).
  store.resetTimersForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The store's live list, via the same snapshot the hook reads. */
function timers() {
  return store._timersForTests();
}

describe("addTimer", () => {
  it("creates a running timer with an absolute deadline (and warms audio , gesture path)", () => {
    store.addTimer(10 * 60_000, "Tea");
    expect(warmAudio).toHaveBeenCalledTimes(1);
    const t = timers()[0];
    expect(t.id.startsWith("timer_")).toBe(true);
    expect(t.label).toBe("Tea");
    expect(t.state).toBe("running");
    expect(t.endsAtMs).toBe(BASE + 10 * 60_000);
    expect(t.remainingMs).toBe(10 * 60_000);
  });

  it("rejects non-positive durations", () => {
    store.addTimer(0);
    store.addTimer(-5);
    store.addTimer(Number.NaN);
    expect(timers()).toHaveLength(0);
  });
});

describe("completion + nag", () => {
  it("fires exactly one initial timerDone at the deadline crossing", () => {
    store.addTimer(1_000);
    expect(playCue).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(playCue).toHaveBeenCalledTimes(1);
    expect(playCue).toHaveBeenCalledWith("timerDone");
    const t = timers()[0];
    expect(t.state).toBe("done");
    expect(t.doneAtMs).toBe(BASE + 1_000);
    expect(t.dismissedCue).toBe(false);
    // The very next ticks do NOT replay , the nag waits its 8 s.
    vi.advanceTimersByTime(1_000);
    expect(playCue).toHaveBeenCalledTimes(1);
  });

  it("replays every 8 s while un-dismissed, then auto-silences at 5 min (card stays)", () => {
    store.addTimer(1_000);
    vi.advanceTimersByTime(1_000); // initial cue
    vi.advanceTimersByTime(8_000);
    expect(playCue.mock.calls.length).toBeGreaterThanOrEqual(2);

    // Run well past the cap: nag must stop, card must stay.
    vi.advanceTimersByTime(6 * 60_000);
    const callsAtCap = playCue.mock.calls.length;
    vi.advanceTimersByTime(60_000);
    expect(playCue.mock.calls.length).toBe(callsAtCap);
    const t = timers()[0];
    expect(t.state).toBe("done");
    expect(t.dismissedCue).toBe(true);
  });

  it("stopTimerRinging silences the nag but keeps the done card", () => {
    store.addTimer(1_000);
    vi.advanceTimersByTime(1_000);
    store.stopTimerRinging(timers()[0].id);
    const calls = playCue.mock.calls.length;
    vi.advanceTimersByTime(60_000);
    expect(playCue.mock.calls.length).toBe(calls);
    expect(timers()[0].state).toBe("done");
  });

  it("dismissTimer clears the done card entirely", () => {
    store.addTimer(1_000);
    vi.advanceTimersByTime(1_000);
    store.dismissTimer(timers()[0].id);
    expect(timers()).toHaveLength(0);
  });
});

describe("pause / resume", () => {
  it("preserves remaining across an arbitrarily long pause", () => {
    store.addTimer(60_000);
    vi.advanceTimersByTime(10_000);
    const id = timers()[0].id;
    store.pauseTimer(id);
    let t = timers()[0];
    expect(t.state).toBe("paused");
    expect(t.endsAtMs).toBeNull();
    expect(t.remainingMs).toBe(50_000);

    // Time passing while paused is free.
    vi.advanceTimersByTime(30 * 60_000);
    store.resumeTimer(id);
    t = timers()[0];
    expect(t.state).toBe("running");
    expect(t.endsAtMs).toBe(Date.now() + 50_000);

    vi.advanceTimersByTime(50_000);
    expect(timers()[0].state).toBe("done");
    expect(playCue).toHaveBeenCalledTimes(1);
  });
});

describe("ticker lifecycle", () => {
  it("holds a ticker handle only while running or nagging", () => {
    expect(vi.getTimerCount()).toBe(0);
    store.addTimer(5_000);
    expect(vi.getTimerCount()).toBe(1);
    store.deleteTimer(timers()[0].id);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases the handle once a done timer's ringing is stopped", () => {
    store.addTimer(1_000);
    vi.advanceTimersByTime(1_000);
    expect(vi.getTimerCount()).toBe(1); // nag keeps it
    store.stopTimerRinging(timers()[0].id);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("persistence", () => {
  it("writes on mutations + transitions only , steady ticks write nothing", () => {
    const setItem = vi.spyOn(window.localStorage, "setItem");
    store.addTimer(10 * 60_000);
    expect(setItem).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5_000); // 20 steady ticks
    expect(setItem).toHaveBeenCalledTimes(1);
    store.pauseTimer(timers()[0].id);
    expect(setItem).toHaveBeenCalledTimes(2);
    setItem.mockRestore();
  });
});

describe("boot resume (deploy reload is the common case)", () => {
  it("a still-running deadline keeps ticking after a module reset, no mutation needed", async () => {
    store.addTimer(30_000);
    vi.advanceTimersByTime(5_000);

    // "Reload": drop the live instance (releasing its ticker), then re-import.
    store.resetTimersForTests();
    playCue.mockClear();
    store = await freshStore();

    const t = timers()[0];
    expect(t.state).toBe("running");
    expect(t.endsAtMs).toBe(BASE + 30_000);
    // Load alone must have re-acquired the ticker , advancing to the deadline
    // fires the cue with NO setter ever called.
    vi.advanceTimersByTime(25_000);
    expect(playCue).toHaveBeenCalledTimes(1);
    expect(playCue).toHaveBeenCalledWith("timerDone");
    expect(timers()[0].state).toBe("done");
  });

  it("a deadline that expired 30 s ago (inside the grace window) fires the cue at load", async () => {
    const record = {
      id: "timer_grace",
      label: null,
      durationMs: 60_000,
      endsAtMs: BASE - 30_000,
      remainingMs: 0,
      state: "running",
      doneAtMs: null,
      dismissedCue: false,
      createdAtMs: BASE - 90_000,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, timers: [record] }));
    store.resetTimersForTests();
    playCue.mockClear();
    store = await freshStore();

    expect(playCue).toHaveBeenCalledTimes(1);
    const t = timers()[0];
    expect(t.state).toBe("done");
    expect(t.dismissedCue).toBe(false);
    expect(t.doneAtMs).toBe(BASE - 30_000);
    // ...and the nag is live (ticker held).
    expect(vi.getTimerCount()).toBe(1);
  });

  it("a deadline that expired 5 min ago (beyond grace) resolves to a silent done card", async () => {
    const record = {
      id: "timer_stale",
      label: null,
      durationMs: 60_000,
      endsAtMs: BASE - 5 * 60_000,
      remainingMs: 0,
      state: "running",
      doneAtMs: null,
      dismissedCue: false,
      createdAtMs: BASE - 6 * 60_000,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, timers: [record] }));
    store.resetTimersForTests();
    playCue.mockClear();
    store = await freshStore();

    expect(playCue).not.toHaveBeenCalled();
    const t = timers()[0];
    expect(t.state).toBe("done");
    expect(t.dismissedCue).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("restartTimer", () => {
  it("re-runs from the original duration", () => {
    store.addTimer(2_000);
    vi.advanceTimersByTime(2_000);
    const id = timers()[0].id;
    store.restartTimer(id);
    const t = timers()[0];
    expect(t.state).toBe("running");
    expect(t.endsAtMs).toBe(Date.now() + 2_000);
    expect(t.dismissedCue).toBe(false);
    expect(t.doneAtMs).toBeNull();
  });
});
