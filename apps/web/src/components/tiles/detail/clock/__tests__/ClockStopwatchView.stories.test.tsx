/**
 * Vitest smoke tests for ClockStopwatchView stories , composeStories renders
 * each fixture (zero / running with laps / stopped) in jsdom so a story that
 * throws or drifts from the view's props fails the suite.
 */

import "@testing-library/jest-dom";
import { composeStories } from "@storybook/react-vite";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as stories from "../ClockStopwatchView.stories";

const { Zero, RunningWithLaps, Stopped } = composeStories(stories);

afterEach(cleanup);

describe("ClockStopwatchView stories", () => {
  it("Zero renders the untouched readout with a disabled Lap", () => {
    render(<Zero />);
    expect(screen.getByRole("timer", { name: "Stopwatch" })).toHaveTextContent("00:00.00");
    expect(screen.getByRole("button", { name: "Lap" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Start" })).toBeEnabled();
  });

  it("RunningWithLaps renders the live lap on top and Stop", () => {
    render(<RunningWithLaps />);
    expect(screen.getByRole("timer", { name: "Stopwatch" })).toHaveTextContent("01:45.46");
    expect(screen.getByRole("button", { name: "Stop" })).toBeEnabled();
    const labels = screen.getAllByText(/^Lap \d/).map((el) => el.textContent);
    expect(labels).toEqual(["Lap 4", "Lap 3", "Lap 2", "Lap 1"]);
  });

  it("Stopped renders the frozen readout with Reset + Start", () => {
    render(<Stopped />);
    expect(screen.getByRole("timer", { name: "Stopwatch" })).toHaveTextContent("02:04.32");
    expect(screen.getByRole("button", { name: "Reset" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Start" })).toBeEnabled();
  });
});
