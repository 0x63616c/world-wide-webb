/**
 * Vitest component tests for ClimateHouseSummaryHeader stories.
 * Uses composeStories to execute each story (including play functions) in jsdom.
 */

import "@testing-library/jest-dom";
import { composeStories } from "@storybook/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as stories from "../ClimateHouseSummaryHeader.stories";

const { Idle, Active, ScheduleLabel, WithRightSlot } = composeStories(stories);

afterEach(cleanup);

describe("ClimateHouseSummaryHeader stories — Idle", () => {
  it("renders rounded avg temp and second label", async () => {
    const { container } = render(<Idle />);
    if (Idle.play) await Idle.play({ canvasElement: container });
    expect(screen.getByText("72°F")).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
  });
});

describe("ClimateHouseSummaryHeader stories — Active", () => {
  it("renders rounded avg temp and status label when any zone is active", async () => {
    const { container } = render(<Active />);
    if (Active.play) await Active.play({ canvasElement: container });
    expect(screen.getByText("69°F")).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
  });
});

describe("ClimateHouseSummaryHeader stories — ScheduleLabel", () => {
  it("renders rounded avg temp and Schedule label", async () => {
    const { container } = render(<ScheduleLabel />);
    if (ScheduleLabel.play) await ScheduleLabel.play({ canvasElement: container });
    expect(screen.getByText("74°F")).toBeInTheDocument();
    expect(screen.getByText("Schedule")).toBeInTheDocument();
  });
});

describe("ClimateHouseSummaryHeader stories — WithRightSlot", () => {
  it("renders avg temp and the optional right-slot element", async () => {
    const { container } = render(<WithRightSlot />);
    if (WithRightSlot.play) await WithRightSlot.play({ canvasElement: container });
    expect(screen.getByText("72°F")).toBeInTheDocument();
    expect(screen.getByTestId("right-slot")).toBeInTheDocument();
    expect(screen.getByText("Now · 14:00")).toBeInTheDocument();
  });
});
