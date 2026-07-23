/**
 * ClockTimerView , RTL tests over the PURE view: fixture records + a fixed
 * `nowMs`, every gesture asserted against its callback. No stores, no fake
 * timers , remaining time is pure arithmetic over the fixtures.
 */

import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TimerRecord } from "@/lib/time-suite/types";
import { ClockTimerView, type ClockTimerViewProps } from "../ClockTimerView";

afterEach(cleanup);

const NOW_MS = 1_750_000_000_000;

function timer(patch: Partial<TimerRecord>): TimerRecord {
  return {
    id: "timer_t1",
    label: null,
    durationMs: 10 * 60_000,
    endsAtMs: null,
    remainingMs: 0,
    state: "done",
    doneAtMs: null,
    dismissedCue: false,
    createdAtMs: NOW_MS - 60_000,
    ...patch,
  };
}

function renderView(patch: Partial<ClockTimerViewProps> = {}) {
  const callbacks = {
    onAdd: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onDelete: vi.fn(),
    onDismiss: vi.fn(),
    onRestart: vi.fn(),
    onStopRinging: vi.fn(),
  };
  render(<ClockTimerView timers={[]} nowMs={NOW_MS} {...callbacks} {...patch} />);
  return callbacks;
}

describe("empty state", () => {
  it("shows the quiet line with Start disabled at 0:00:00", () => {
    renderView();
    expect(screen.getByText("No timers running")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
  });

  it("starts a preset directly: 10 min → onAdd(600000)", () => {
    const { onAdd } = renderView();
    fireEvent.click(screen.getByRole("button", { name: "10 min" }));
    expect(onAdd).toHaveBeenCalledExactlyOnceWith(10 * 60_000);
  });

  it("wheel entry: 5 minutes enables Start and adds 300000 ms", () => {
    const { onAdd } = renderView();
    const minutes = screen.getByRole("listbox", { name: "Minutes" });
    fireEvent.click(within(minutes).getByRole("option", { name: "05" }));
    const start = screen.getByRole("button", { name: "Start" });
    expect(start).toBeEnabled();
    fireEvent.click(start);
    expect(onAdd).toHaveBeenCalledExactlyOnceWith(5 * 60_000);
  });
});

describe("running card", () => {
  const running = timer({
    label: "Tea",
    state: "running",
    endsAtMs: NOW_MS + 253_000, // 4:13 remaining (ceiled)
    remainingMs: 253_000,
  });

  it("derives remaining digits from the absolute deadline", () => {
    renderView({ timers: [running] });
    const card = within(screen.getByTestId("timer-card-timer_t1"));
    expect(card.getByText("4:13")).toBeInTheDocument();
    expect(card.getByText("Tea")).toBeInTheDocument();
    // The original-duration subtitle , scoped to the card (the preset grid
    // also renders a "10 min" chip).
    expect(card.getByText("10 min")).toBeInTheDocument();
  });

  it("Pause and Delete route to their callbacks with the id", () => {
    const { onPause, onDelete } = renderView({ timers: [running] });
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(onPause).toHaveBeenCalledExactlyOnceWith("timer_t1");
    fireEvent.click(screen.getByRole("button", { name: "Delete Tea" }));
    expect(onDelete).toHaveBeenCalledExactlyOnceWith("timer_t1");
  });

  it("tints the digits accent inside the final 10 s", () => {
    renderView({ timers: [timer({ state: "running", endsAtMs: NOW_MS + 8_000 })] });
    expect(screen.getByText("0:08")).toHaveStyle({ color: "var(--acc)" });
  });

  it("keeps plain ink outside the final 10 s", () => {
    renderView({ timers: [running] });
    expect(screen.getByText("4:13")).toHaveStyle({ color: "var(--ink)" });
  });

  it("shows H:MM:SS from one hour up", () => {
    renderView({
      timers: [
        timer({ state: "running", durationMs: 2 * 3_600_000, endsAtMs: NOW_MS + 5_025_000 }),
      ],
    });
    expect(screen.getByText("1:23:45")).toBeInTheDocument();
  });
});

describe("paused card", () => {
  it("shows the stored remaining and Resume routes with the id", () => {
    const { onResume } = renderView({
      timers: [timer({ state: "paused", remainingMs: 32 * 60_000 + 5_000 })],
    });
    expect(screen.getByText("32:05")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(onResume).toHaveBeenCalledExactlyOnceWith("timer_t1");
  });
});

describe("done card", () => {
  it("ringing: accent card with Stop → onStopRinging", () => {
    const { onStopRinging } = renderView({
      timers: [timer({ state: "done", doneAtMs: NOW_MS - 5_000 })],
    });
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStopRinging).toHaveBeenCalledExactlyOnceWith("timer_t1");
  });

  it("silenced: Restart and Dismiss route to their callbacks", () => {
    const { onRestart, onDismiss } = renderView({
      timers: [timer({ state: "done", doneAtMs: NOW_MS - 60_000, dismissedCue: true })],
    });
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    expect(onRestart).toHaveBeenCalledExactlyOnceWith("timer_t1");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss Timer" }));
    expect(onDismiss).toHaveBeenCalledExactlyOnceWith("timer_t1");
  });
});

describe("layout law", () => {
  const three = [
    timer({ id: "timer_a", state: "running", endsAtMs: NOW_MS + 60_000 }),
    timer({ id: "timer_b", state: "paused", remainingMs: 30_000 }),
    timer({ id: "timer_c", state: "done", doneAtMs: NOW_MS - 1_000 }),
  ];

  it("one timer renders the hero card, not the grid", () => {
    renderView({ timers: [timer({ state: "running", endsAtMs: NOW_MS + 60_000 })] });
    expect(screen.queryByTestId("timer-card-grid")).not.toBeInTheDocument();
    expect(screen.getByTestId("timer-card-timer_t1")).toBeInTheDocument();
  });

  it("2-4 timers render the 2-column grid with every card", () => {
    renderView({ timers: three });
    const grid = screen.getByTestId("timer-card-grid");
    expect(within(grid).getByTestId("timer-card-timer_a")).toBeInTheDocument();
    expect(within(grid).getByTestId("timer-card-timer_b")).toBeInTheDocument();
    expect(within(grid).getByTestId("timer-card-timer_c")).toBeInTheDocument();
    expect(grid).not.toHaveStyle({ overflowY: "auto" });
  });

  it(">4 timers make the grid scroll", () => {
    renderView({
      timers: [
        ...three,
        timer({ id: "timer_d", state: "paused", remainingMs: 10_000 }),
        timer({ id: "timer_e", state: "paused", remainingMs: 20_000 }),
      ],
    });
    expect(screen.getByTestId("timer-card-grid")).toHaveStyle({ overflowY: "auto" });
  });
});
