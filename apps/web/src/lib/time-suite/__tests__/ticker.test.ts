/**
 * The shared tick source's lifecycle contract: one interval, running iff the
 * handle set is non-empty, with idempotent releases.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startTicks } from "../ticker";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("startTicks", () => {
  it("ticks a registered callback every 250 ms with the wall-clock now", () => {
    vi.setSystemTime(1_000_000);
    const fn = vi.fn();
    const release = startTicks(fn);

    vi.advanceTimersByTime(250);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenLastCalledWith(1_000_250);

    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(3);
    release();
  });

  it("stops the interval when the last handle releases (join/leave/rejoin)", () => {
    const a = vi.fn();
    const b = vi.fn();
    const releaseA = startTicks(a);
    const releaseB = startTicks(b);

    vi.advanceTimersByTime(250);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    // One handle left , still ticking.
    releaseA();
    vi.advanceTimersByTime(250);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);

    // Last handle gone , interval fully stops (no pending timers at all).
    releaseB();
    vi.advanceTimersByTime(10_000);
    expect(b).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);

    // Rejoin restarts a fresh interval.
    const c = vi.fn();
    const releaseC = startTicks(c);
    vi.advanceTimersByTime(250);
    expect(c).toHaveBeenCalledTimes(1);
    releaseC();
  });

  it("release is idempotent , a double release never drops another's handle", () => {
    const a = vi.fn();
    const b = vi.fn();
    const releaseA = startTicks(a);
    const releaseB = startTicks(b);

    releaseA();
    releaseA(); // second release of the same handle must be a no-op

    vi.advanceTimersByTime(250);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    releaseB();
  });

  it("a callback releasing its own handle mid-tick does not break the loop", () => {
    const calls: string[] = [];
    const releaseA = startTicks(() => {
      calls.push("a");
      releaseA();
    });
    startTicks(() => calls.push("b"));

    vi.advanceTimersByTime(250);
    expect(calls).toEqual(["a", "b"]);

    vi.advanceTimersByTime(250);
    expect(calls).toEqual(["a", "b", "b"]);
  });
});
