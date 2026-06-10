/**
 * Tests for useThrottledVolume hook (CC-83z4).
 *
 * The hook throttles network volume writes to ~200ms (leading + trailing) per
 * deviceIp, so a rapid fader drag sends at most ~1 write/200ms and the
 * trailing edge always sends the final value.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useThrottledVolume } from "../hooks/useThrottledVolume";

describe("useThrottledVolume — throttle behaviour (CC-83z4)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires immediately on the leading edge (first call)", () => {
    const onWrite = vi.fn();
    const { result } = renderHook(() => useThrottledVolume(onWrite));

    act(() => {
      result.current("192.168.1.10", 50);
    });

    // Leading call fires immediately.
    expect(onWrite).toHaveBeenCalledTimes(1);
    expect(onWrite).toHaveBeenCalledWith("192.168.1.10", 50);
  });

  it("N rapid calls within 200ms collapse to 1 leading + 1 trailing write with the final value", () => {
    const onWrite = vi.fn();
    const { result } = renderHook(() => useThrottledVolume(onWrite));

    // Fire 10 calls rapidly within the 200ms window.
    act(() => {
      for (let v = 50; v <= 59; v++) {
        result.current("192.168.1.10", v);
      }
    });

    // Leading call should have fired for v=50 immediately.
    expect(onWrite).toHaveBeenCalledTimes(1);
    expect(onWrite).toHaveBeenLastCalledWith("192.168.1.10", 50);

    // Advance past 200ms window — trailing call fires with final value (59).
    act(() => {
      vi.advanceTimersByTime(201);
    });

    expect(onWrite).toHaveBeenCalledTimes(2);
    expect(onWrite).toHaveBeenLastCalledWith("192.168.1.10", 59);
  });

  it("trailing edge fires the FINAL value after the drag ends", () => {
    const onWrite = vi.fn();
    const { result } = renderHook(() => useThrottledVolume(onWrite));

    act(() => {
      result.current("192.168.1.10", 40); // leading
      result.current("192.168.1.10", 60); // mid-drag, overwritten
      result.current("192.168.1.10", 75); // final
    });

    act(() => vi.advanceTimersByTime(201));

    expect(onWrite).toHaveBeenCalledTimes(2);
    // First call: leading (40), second call: trailing (75).
    expect(onWrite.mock.calls[0]).toEqual(["192.168.1.10", 40]);
    expect(onWrite.mock.calls[1]).toEqual(["192.168.1.10", 75]);
  });

  it("dedupes: skip the write if value equals the last value sent for that deviceIp", () => {
    const onWrite = vi.fn();
    const { result } = renderHook(() => useThrottledVolume(onWrite));

    // Leading call at 50.
    act(() => result.current("192.168.1.10", 50));
    expect(onWrite).toHaveBeenCalledTimes(1);

    // Advance past window — trailing would fire but the value hasn't changed.
    act(() => vi.advanceTimersByTime(201));
    // Still only 1 call because trailing value (50) == last sent (50).
    expect(onWrite).toHaveBeenCalledTimes(1);
  });

  it("dedup on leading edge does NOT arm a dead timer that delays the next call", () => {
    // Regression for the reviewer-found bug: when the leading write is skipped
    // because volume === lastSent, no timer should be armed. If a timer WERE
    // armed, the very next call (new value) would fall into the "timer in flight"
    // branch and get a ~200ms lag instead of firing immediately on the leading edge.
    const onWrite = vi.fn();
    const { result } = renderHook(() => useThrottledVolume(onWrite));

    // First call: leading fires at 50, timer arms.
    act(() => result.current("192.168.1.10", 50));
    expect(onWrite).toHaveBeenCalledTimes(1);

    // Let the timer expire cleanly (pending == lastSent so no trailing write).
    act(() => vi.advanceTimersByTime(201));
    expect(onWrite).toHaveBeenCalledTimes(1);

    // Second call: same value 50 — dedup, no leading write, no timer should arm.
    act(() => result.current("192.168.1.10", 50));
    expect(onWrite).toHaveBeenCalledTimes(1); // still deduped

    // Third call: new value 60. If the dedup above incorrectly armed a timer,
    // this call lands in the "timer in flight" branch and gets deferred (lag).
    // If no timer was armed, this fires immediately on the leading edge.
    act(() => result.current("192.168.1.10", 60));
    // Must fire immediately — NOT deferred.
    expect(onWrite).toHaveBeenCalledTimes(2);
    expect(onWrite).toHaveBeenLastCalledWith("192.168.1.10", 60);
  });

  it("throttles per-deviceIp independently (different IPs don't interfere)", () => {
    const onWrite = vi.fn();
    const { result } = renderHook(() => useThrottledVolume(onWrite));

    // Two different speakers dragged rapidly.
    act(() => {
      result.current("192.168.1.10", 50);
      result.current("192.168.1.20", 70);
      result.current("192.168.1.10", 55);
      result.current("192.168.1.20", 75);
    });

    // Two leading calls (one per IP).
    expect(onWrite).toHaveBeenCalledTimes(2);

    act(() => vi.advanceTimersByTime(201));

    // Two trailing calls (one per IP with final values).
    expect(onWrite).toHaveBeenCalledTimes(4);
    expect(onWrite).toHaveBeenCalledWith("192.168.1.10", 55);
    expect(onWrite).toHaveBeenCalledWith("192.168.1.20", 75);
  });

  it("cleans up pending timers on unmount (no timer fires after unmount)", () => {
    const onWrite = vi.fn();
    const { result, unmount } = renderHook(() => useThrottledVolume(onWrite));

    act(() => {
      result.current("192.168.1.10", 50); // leading fires
      result.current("192.168.1.10", 60); // queues trailing
    });

    expect(onWrite).toHaveBeenCalledTimes(1);

    // Unmount before the trailing timer fires.
    unmount();

    act(() => vi.advanceTimersByTime(201));

    // Trailing call must NOT fire after unmount.
    expect(onWrite).toHaveBeenCalledTimes(1);
  });
});
