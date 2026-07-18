import { renderHook } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDLE_RESET_MS, useIdleReset } from "../useBoard";

// Drives useIdleReset against a real (jsdom) stage element so the event
// listeners and timers exercise the production wiring. goHome/isHome/pointerDown
// are injected so each case controls "where the board is" without a real scroll.
function setup(opts: { isHome: boolean; pointerDown?: boolean }) {
  const stage = document.createElement("div");
  document.body.appendChild(stage);
  const goHome = vi.fn();

  const { unmount } = renderHook(() => {
    const pointerDown = useRef(opts.pointerDown ?? false);
    useIdleReset({
      stage,
      goHome,
      isHome: () => opts.isHome,
      pointerDown,
    });
  });

  return { stage, goHome, unmount };
}

describe("useIdleReset", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("navigates home after the idle window on a non-home view", () => {
    const { goHome } = setup({ isHome: false });

    expect(goHome).not.toHaveBeenCalled();
    vi.advanceTimersByTime(IDLE_RESET_MS);
    expect(goHome).toHaveBeenCalledTimes(1);
  });

  it("a simulated interaction before the window resets the timer (no nav)", () => {
    const { stage, goHome } = setup({ isHome: false });

    // Interact just shy of the window, then wait almost another full window:
    // a working reset means the total elapsed time never triggers a nav.
    vi.advanceTimersByTime(IDLE_RESET_MS - 1_000);
    stage.dispatchEvent(new Event("pointerdown"));
    vi.advanceTimersByTime(IDLE_RESET_MS - 1_000);
    expect(goHome).not.toHaveBeenCalled();

    // Once a fresh full window elapses with no interaction, it fires.
    vi.advanceTimersByTime(1_000);
    expect(goHome).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when already on the home view", () => {
    const { goHome } = setup({ isHome: true });

    vi.advanceTimersByTime(IDLE_RESET_MS * 2);
    expect(goHome).not.toHaveBeenCalled();
  });

  it("does not navigate while a pointer is held, then fires after release", () => {
    const stage = document.createElement("div");
    document.body.appendChild(stage);
    const goHome = vi.fn();
    const held = { current: true };

    renderHook(() => {
      useIdleReset({
        stage,
        goHome,
        isHome: () => false,
        pointerDown: held as React.RefObject<boolean>,
      });
    });

    // Window elapses while held: the timer fires but defers instead of navigating.
    vi.advanceTimersByTime(IDLE_RESET_MS);
    expect(goHome).not.toHaveBeenCalled();

    // Release; the deferred re-check (1s tick) now navigates.
    held.current = false;
    vi.advanceTimersByTime(1_000);
    expect(goHome).toHaveBeenCalledTimes(1);
  });

  it("clears its timeout on unmount (no late navigation)", () => {
    const { goHome, unmount } = setup({ isHome: false });

    vi.advanceTimersByTime(IDLE_RESET_MS - 1_000);
    unmount();
    vi.advanceTimersByTime(IDLE_RESET_MS);
    expect(goHome).not.toHaveBeenCalled();
  });
});
