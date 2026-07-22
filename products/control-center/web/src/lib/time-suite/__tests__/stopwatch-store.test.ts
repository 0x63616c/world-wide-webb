/**
 * Stopwatch store contract: wall-clock span accounting (reload-proof), Apple
 * lap/reset semantics, and the pure derivation helpers the view leans on.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Pure derivations are side-effect-free , static imports, unaffected by the
// freshStore() module resets below.
import { lapExtremes, stopwatchElapsedMs } from "../pure";
import { installMemoryLocalStorage } from "./memory-local-storage";

type StopwatchStore = typeof import("../stopwatch-store");

const BASE = new Date(2026, 6, 20, 10, 0, 0).getTime();

let store: StopwatchStore;

async function freshStore(): Promise<StopwatchStore> {
  vi.resetModules();
  return await import("../stopwatch-store");
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(BASE);
  installMemoryLocalStorage();
  store = await freshStore();
});

afterEach(() => {
  store.resetStopwatchForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("elapsed accounting", () => {
  it("accumulates across run/stop spans", () => {
    store.startStopwatch();
    vi.advanceTimersByTime(5_000);
    store.stopStopwatch();
    expect(stopwatchElapsedMs(store._stateForTests(), Date.now())).toBe(5_000);

    // Stopped time is free.
    vi.advanceTimersByTime(60_000);
    store.startStopwatch();
    vi.advanceTimersByTime(2_000);
    expect(stopwatchElapsedMs(store._stateForTests(), Date.now())).toBe(7_000);
  });

  it("keeps counting across a module reset (deploy reload)", async () => {
    store.startStopwatch();
    vi.advanceTimersByTime(5_000);

    store = await freshStore();
    const s = store._stateForTests();
    expect(s.running).toBe(true);
    expect(stopwatchElapsedMs(s, Date.now())).toBe(5_000);
    vi.advanceTimersByTime(3_000);
    expect(stopwatchElapsedMs(s, Date.now())).toBe(8_000);
  });
});

describe("laps", () => {
  it("slices laps at the current elapsed, newest first", () => {
    store.startStopwatch();
    vi.advanceTimersByTime(3_000);
    store.lapStopwatch();
    vi.advanceTimersByTime(2_000);
    store.lapStopwatch();

    const s = store._stateForTests();
    expect(s.laps).toEqual([
      { id: "lap_2", ms: 2_000 },
      { id: "lap_1", ms: 3_000 },
    ]);
    expect(s.lapStartElapsedMs).toBe(5_000);
  });

  it("is running-only", () => {
    store.lapStopwatch();
    expect(store._stateForTests().laps).toHaveLength(0);
  });
});

describe("lapExtremes", () => {
  it("is null/null under 2 completed laps", () => {
    expect(lapExtremes([])).toEqual({ fastestId: null, slowestId: null });
    expect(lapExtremes([{ id: "lap_1", ms: 1_000 }])).toEqual({
      fastestId: null,
      slowestId: null,
    });
  });

  it("tags the fastest and slowest of ≥2 laps", () => {
    expect(
      lapExtremes([
        { id: "lap_3", ms: 2_000 },
        { id: "lap_2", ms: 900 },
        { id: "lap_1", ms: 3_000 },
      ]),
    ).toEqual({ fastestId: "lap_2", slowestId: "lap_1" });
  });
});

describe("reset", () => {
  it("is allowed whenever stopped with elapsed > 0 , laps or not", () => {
    store.startStopwatch();
    vi.advanceTimersByTime(12_400);
    store.stopStopwatch();
    // The Apple case: a lapless stop at 00:12.40 must be resettable.
    expect(store._stateForTests().laps).toHaveLength(0);
    store.resetStopwatch();
    expect(store._stateForTests()).toEqual({
      running: false,
      startedAtMs: null,
      accumulatedMs: 0,
      lapStartElapsedMs: 0,
      laps: [],
    });
  });

  it("is a no-op while running or at zero", () => {
    store.resetStopwatch(); // at zero
    store.startStopwatch();
    vi.advanceTimersByTime(1_000);
    store.resetStopwatch(); // running
    expect(store._stateForTests().running).toBe(true);
  });
});

describe("ticker discipline", () => {
  it("never schedules an interval , the view drives its own rAF readout", () => {
    store.startStopwatch();
    expect(vi.getTimerCount()).toBe(0);
  });
});
