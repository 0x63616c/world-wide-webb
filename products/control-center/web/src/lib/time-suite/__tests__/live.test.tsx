/**
 * useTimeSuiteLive , the "anything live?" selector the clock detail wiring
 * hangs its conditional idle hold on. Driven against the REAL stores (reset
 * seams between cases); lib/sound is mocked so cues stay silent.
 */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMemoryLocalStorage } from "./memory-local-storage";

vi.mock("../../sound", () => ({ playCue: vi.fn(), warmAudio: vi.fn() }));

import { addAlarm, dismissAlarmFiring, resetAlarmsForTests } from "../alarm-store";
import { useTimeSuiteLive } from "../live";
import { resetStopwatchForTests, startStopwatch, stopStopwatch } from "../stopwatch-store";
import {
  _tickForTests,
  addTimer,
  pauseTimer,
  resetTimersForTests,
  stopTimerRinging,
} from "../timer-store";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 6, 20, 10, 0, 0));
  installMemoryLocalStorage();
});

afterEach(() => {
  cleanup();
  resetTimersForTests();
  resetStopwatchForTests();
  resetAlarmsForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useTimeSuiteLive", () => {
  it("is false when nothing runs, rings, or fires", () => {
    const { result } = renderHook(() => useTimeSuiteLive());
    expect(result.current).toBe(false);
  });

  it("tracks a running timer, stays true while it rings, false once stopped", () => {
    const { result } = renderHook(() => useTimeSuiteLive());

    act(() => addTimer(1_000));
    expect(result.current).toBe(true);

    // Deadline crossing: done + un-dismissed = still live (ringing).
    act(() => _tickForTests(Date.now() + 1_000));
    expect(result.current).toBe(true);

    act(() => {
      const doneId = JSON.parse(window.localStorage.getItem("cc-timers-v1") as string).timers[0]
        .id as string;
      stopTimerRinging(doneId);
    });
    expect(result.current).toBe(false);
  });

  it("a paused timer is not live", () => {
    const { result } = renderHook(() => useTimeSuiteLive());
    act(() => addTimer(60_000));
    const id = JSON.parse(window.localStorage.getItem("cc-timers-v1") as string).timers[0]
      .id as string;
    act(() => pauseTimer(id));
    expect(result.current).toBe(false);
  });

  it("tracks the stopwatch running state", () => {
    const { result } = renderHook(() => useTimeSuiteLive());
    act(() => startStopwatch());
    expect(result.current).toBe(true);
    act(() => stopStopwatch());
    expect(result.current).toBe(false);
  });

  it("tracks a firing alarm until dismissed (a merely-enabled alarm is not live)", () => {
    const { result } = renderHook(() => useTimeSuiteLive());
    act(() => addAlarm({ hour: 10, minute: 1 }));
    expect(result.current).toBe(false); // enabled but dormant

    act(() => vi.advanceTimersByTime(60_000)); // fires
    expect(result.current).toBe(true);

    act(() => dismissAlarmFiring());
    expect(result.current).toBe(false);
  });
});
