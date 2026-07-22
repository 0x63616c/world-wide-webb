import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetSessionForTests,
  DEFAULT_SESSION_TIMEOUT_MS,
  panelSession,
  setSessionEnabled,
} from "../index";

// The clock is a real setTimeout driven by fake timers; every test enables the
// session (the module is inert until Board turns it on) and resets state first.
describe("panel-session store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetSessionForTests();
  });
  afterEach(() => {
    // Reset happens in beforeEach; doing it here too would fire a store update
    // while testing-library's not-yet-run cleanup still has hooks mounted.
    vi.useRealTimers();
  });

  it("starts active and locked", () => {
    expect(panelSession.phase()).toBe("active");
    expect(panelSession.isUnlocked()).toBe(false);
  });

  it("stays active while disabled, no matter how long it idles", () => {
    vi.advanceTimersByTime(DEFAULT_SESSION_TIMEOUT_MS * 10);
    expect(panelSession.phase()).toBe("active");
  });

  it("ends exactly once after the timeout when enabled", () => {
    const onEnd = vi.fn();
    panelSession.onSessionEnd(onEnd);
    setSessionEnabled(true);

    vi.advanceTimersByTime(DEFAULT_SESSION_TIMEOUT_MS - 1);
    expect(panelSession.phase()).toBe("active");

    vi.advanceTimersByTime(1);
    expect(panelSession.phase()).toBe("ended");
    expect(onEnd).toHaveBeenCalledOnce();

    // No stray second fire once ended.
    vi.advanceTimersByTime(DEFAULT_SESSION_TIMEOUT_MS * 5);
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it("rearms on touch , a busy panel never ends", () => {
    setSessionEnabled(true);
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(DEFAULT_SESSION_TIMEOUT_MS - 1);
      panelSession.touch();
    }
    expect(panelSession.phase()).toBe("active");
    vi.advanceTimersByTime(DEFAULT_SESSION_TIMEOUT_MS);
    expect(panelSession.phase()).toBe("ended");
  });

  it("wakes an ended session on touch into a fresh, still-locked session", () => {
    const onEnd = vi.fn();
    panelSession.onSessionEnd(onEnd);
    setSessionEnabled(true);
    vi.advanceTimersByTime(DEFAULT_SESSION_TIMEOUT_MS);
    expect(panelSession.phase()).toBe("ended");

    panelSession.touch();
    expect(panelSession.phase()).toBe("active");
    expect(panelSession.isUnlocked()).toBe(false);

    // The woken session ends again on its own timeout , a second end.
    vi.advanceTimersByTime(DEFAULT_SESSION_TIMEOUT_MS);
    expect(panelSession.phase()).toBe("ended");
    expect(onEnd).toHaveBeenCalledTimes(2);
  });

  it("keeps an unlock across touches but drops it at session end", () => {
    setSessionEnabled(true);
    panelSession.unlock();
    expect(panelSession.isUnlocked()).toBe(true);

    panelSession.touch();
    vi.advanceTimersByTime(DEFAULT_SESSION_TIMEOUT_MS - 1);
    panelSession.touch();
    expect(panelSession.isUnlocked()).toBe(true);

    vi.advanceTimersByTime(DEFAULT_SESSION_TIMEOUT_MS);
    expect(panelSession.phase()).toBe("ended");
    expect(panelSession.isUnlocked()).toBe(false);
  });

  it("live-rebases the clock on setTimeoutMs", () => {
    setSessionEnabled(true);
    vi.advanceTimersByTime(30_000);
    // Rebase to a shorter window measured from now.
    panelSession.setTimeoutMs(10_000);
    vi.advanceTimersByTime(9_999);
    expect(panelSession.phase()).toBe("active");
    vi.advanceTimersByTime(1);
    expect(panelSession.phase()).toBe("ended");
  });

  it("wakes and stops the clock when disabled mid-ended", () => {
    setSessionEnabled(true);
    vi.advanceTimersByTime(DEFAULT_SESSION_TIMEOUT_MS);
    expect(panelSession.phase()).toBe("ended");

    setSessionEnabled(false);
    expect(panelSession.phase()).toBe("active");

    // Disabled: it never ends again on its own.
    vi.advanceTimersByTime(DEFAULT_SESSION_TIMEOUT_MS * 3);
    expect(panelSession.phase()).toBe("active");
  });

  it("unregistering an end listener stops it firing", () => {
    const onEnd = vi.fn();
    const off = panelSession.onSessionEnd(onEnd);
    off();
    setSessionEnabled(true);
    vi.advanceTimersByTime(DEFAULT_SESSION_TIMEOUT_MS);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("usePhase re-renders subscribers on the active→ended transition", () => {
    setSessionEnabled(true);
    const { result } = renderHook(() => panelSession.usePhase());
    expect(result.current).toBe("active");
    act(() => {
      vi.advanceTimersByTime(DEFAULT_SESSION_TIMEOUT_MS);
    });
    expect(result.current).toBe("ended");
  });

  it("useIsUnlocked re-renders subscribers on unlock", () => {
    const { result } = renderHook(() => panelSession.useIsUnlocked());
    expect(result.current).toBe(false);
    act(() => panelSession.unlock());
    expect(result.current).toBe(true);
  });
});
