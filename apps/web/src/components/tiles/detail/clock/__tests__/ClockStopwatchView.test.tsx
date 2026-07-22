/**
 * RTL tests for the pure ClockStopwatchView: readout formatting, the Apple
 * two-button row (Lap/Reset left, Start/Stop right), lap-list ordering with the
 * live in-progress lap on top, and fastest/slowest tinting via lapExtremes.
 * Pure fixtures , no stores (store behavior has its own suite).
 */

import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StopwatchState } from "../../../../../lib/time-suite/types";
import { ClockStopwatchView, formatStopwatch } from "../ClockStopwatchView";

afterEach(cleanup);

const NOW_MS = 1_800_000_000_000;

const ZERO: StopwatchState = {
  running: false,
  startedAtMs: null,
  accumulatedMs: 0,
  lapStartElapsedMs: 0,
  laps: [],
};

// Three completed laps, newest first: lap_2 fastest, lap_3 slowest.
const LAPS = [
  { id: "lap_3", ms: 33_710 },
  { id: "lap_2", ms: 28_970 },
  { id: "lap_1", ms: 31_120 },
];
const LAPPED_ELAPSED = 33_710 + 28_970 + 31_120; // 93_800

const RUNNING: StopwatchState = {
  running: true,
  startedAtMs: NOW_MS - 105_460, // elapsed 01:45.46
  accumulatedMs: 0,
  lapStartElapsedMs: LAPPED_ELAPSED,
  laps: LAPS,
};

const STOPPED: StopwatchState = {
  running: false,
  startedAtMs: null,
  accumulatedMs: 124_320, // 02:04.32
  lapStartElapsedMs: LAPPED_ELAPSED,
  laps: LAPS,
};

function renderView(state: StopwatchState) {
  const handlers = {
    onStart: vi.fn(),
    onStop: vi.fn(),
    onLap: vi.fn(),
    onReset: vi.fn(),
  };
  render(<ClockStopwatchView state={state} nowMs={NOW_MS} {...handlers} />);
  return handlers;
}

describe("formatStopwatch", () => {
  it("formats mm:ss.cc and rolls to h:mm:ss.cc past an hour", () => {
    expect(formatStopwatch(0)).toBe("00:00.00");
    expect(formatStopwatch(105_460)).toBe("01:45.46");
    expect(formatStopwatch(3_600_000)).toBe("1:00:00.00");
    expect(formatStopwatch(-50)).toBe("00:00.00");
  });
});

describe("ClockStopwatchView , zero", () => {
  it("shows 00:00.00, a disabled Lap, and Start wired to onStart", () => {
    const h = renderView(ZERO);
    expect(screen.getByRole("timer", { name: "Stopwatch" })).toHaveTextContent("00:00.00");
    expect(screen.getByRole("button", { name: "Lap" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Reset" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(h.onStart).toHaveBeenCalledTimes(1);
  });

  it("renders no lap list", () => {
    renderView(ZERO);
    expect(screen.queryByText(/^Lap \d/)).not.toBeInTheDocument();
  });
});

describe("ClockStopwatchView , running", () => {
  it("derives the readout from nowMs and wires Lap + Stop", () => {
    const h = renderView(RUNNING);
    expect(screen.getByRole("timer", { name: "Stopwatch" })).toHaveTextContent("01:45.46");
    fireEvent.click(screen.getByRole("button", { name: "Lap" }));
    expect(h.onLap).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(h.onStop).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /Start|Reset/ })).not.toBeInTheDocument();
  });

  it("puts the live in-progress lap on top, then completed laps newest first", () => {
    renderView(RUNNING);
    const labels = screen.getAllByText(/^Lap \d/).map((el) => el.textContent);
    expect(labels).toEqual(["Lap 4", "Lap 3", "Lap 2", "Lap 1"]);
    const live = screen.getByText("Lap 4").closest("[data-live]");
    expect(live).not.toBeNull();
    // In-progress lap = elapsed - lapStartElapsedMs = 105_460 - 93_800.
    expect(live).toHaveTextContent("00:11.66");
  });

  it("tints the fastest lap accent and the slowest muted (≥2 completed laps)", () => {
    renderView(RUNNING);
    expect(screen.getByText("Lap 2").closest("[data-extreme]")).toHaveAttribute(
      "data-extreme",
      "fastest",
    );
    expect(screen.getByText("Lap 3").closest("[data-extreme]")).toHaveAttribute(
      "data-extreme",
      "slowest",
    );
    expect(screen.getByText("Lap 1").closest("[data-extreme]")).toBeNull();
  });

  it("marks no extremes with a single completed lap", () => {
    renderView({ ...RUNNING, laps: [LAPS[0]], lapStartElapsedMs: LAPS[0].ms });
    expect(document.querySelector("[data-extreme]")).toBeNull();
  });
});

describe("ClockStopwatchView , stopped with elapsed > 0", () => {
  it("freezes the readout from accumulatedMs and offers Reset + Start", () => {
    const h = renderView(STOPPED);
    expect(screen.getByRole("timer", { name: "Stopwatch" })).toHaveTextContent("02:04.32");
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(h.onReset).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(h.onStart).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Lap" })).not.toBeInTheDocument();
  });

  it("offers Reset for a lapless stop (Apple semantics)", () => {
    const h = renderView({ ...ZERO, accumulatedMs: 12_400 });
    expect(screen.getByRole("timer", { name: "Stopwatch" })).toHaveTextContent("00:12.40");
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(h.onReset).toHaveBeenCalledTimes(1);
  });

  it("keeps the frozen in-progress lap on top when stopped mid-session", () => {
    renderView(STOPPED);
    const labels = screen.getAllByText(/^Lap \d/).map((el) => el.textContent);
    expect(labels).toEqual(["Lap 4", "Lap 3", "Lap 2", "Lap 1"]);
  });
});
