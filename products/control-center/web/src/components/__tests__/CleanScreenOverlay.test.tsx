import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { CLEAN_MODE_DURATION_MS, CleanScreenOverlay, HOLD_TO_EXIT_MS } from "../CleanScreenOverlay";

describe("CleanScreenOverlay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders nothing while closed", () => {
    render(<CleanScreenOverlay open={false} onClose={() => {}} />);
    expect(screen.queryByTestId("clean-screen-overlay")).toBeNull();
  });

  it("shows the full countdown when opened", () => {
    render(<CleanScreenOverlay open onClose={() => {}} />);
    expect(screen.getByText("Cleaning mode")).toBeInTheDocument();
    expect(screen.getByText("10:00")).toBeInTheDocument();
  });

  it("counts down while open", () => {
    render(<CleanScreenOverlay open onClose={() => {}} />);
    act(() => {
      vi.advanceTimersByTime(79_000);
    });
    expect(screen.getByText("8:41")).toBeInTheDocument();
  });

  it("exits after the hold completes, not before", () => {
    const onClose = vi.fn();
    render(<CleanScreenOverlay open onClose={onClose} />);
    fireEvent.pointerDown(screen.getByRole("button"));
    act(() => {
      vi.advanceTimersByTime(HOLD_TO_EXIT_MS - 500);
    });
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("releasing early resets the hold", () => {
    const onClose = vi.fn();
    render(<CleanScreenOverlay open onClose={onClose} />);
    const button = screen.getByRole("button");
    fireEvent.pointerDown(button);
    act(() => {
      vi.advanceTimersByTime(HOLD_TO_EXIT_MS - 500);
    });
    fireEvent.pointerUp(button);
    // A full further hold-length passes unpressed: released progress must not
    // carry over and complete on its own.
    act(() => {
      vi.advanceTimersByTime(HOLD_TO_EXIT_MS);
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("auto-exits at the 10 minute failsafe", () => {
    const onClose = vi.fn();
    render(<CleanScreenOverlay open onClose={onClose} />);
    act(() => {
      vi.advanceTimersByTime(CLEAN_MODE_DURATION_MS + 1000);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("restarts the countdown on reopen", () => {
    const { rerender } = render(<CleanScreenOverlay open onClose={() => {}} />);
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    rerender(<CleanScreenOverlay open={false} onClose={() => {}} />);
    rerender(<CleanScreenOverlay open onClose={() => {}} />);
    expect(screen.getByText("10:00")).toBeInTheDocument();
  });
});
