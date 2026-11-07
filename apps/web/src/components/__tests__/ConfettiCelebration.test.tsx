import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { CONFETTI_DURATION_MS, ConfettiCelebration } from "../ConfettiCelebration";

describe("ConfettiCelebration", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("plays through its animation window even when the system requests reduced motion", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    const onFinished = vi.fn();
    render(<ConfettiCelebration onFinished={onFinished} />);
    expect(screen.getByTestId("confetti-celebration")).toHaveAttribute("aria-hidden", "true");
    expect(onFinished).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(CONFETTI_DURATION_MS));
    expect(onFinished).toHaveBeenCalledTimes(1);
  });
});
