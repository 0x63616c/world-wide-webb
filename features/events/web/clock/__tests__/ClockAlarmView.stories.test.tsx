/**
 * Vitest smoke tests for ClockAlarmView stories , composeStories runs each
 * story (and its play assertions , EditorOpen's tap-to-edit, Firing's Stop
 * routing) in jsdom so a broken story fails CI, not the Storybook build.
 */

import "@testing-library/jest-dom";
import { composeStories } from "@storybook/react-vite";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as stories from "../ClockAlarmView.stories";

const { Empty, MixedList, EditorOpen, Firing } = composeStories(stories);

afterEach(cleanup);

describe("ClockAlarmView stories", () => {
  it("Empty renders the quiet empty state and the new-alarm entry point", async () => {
    const { container } = render(<Empty />);
    await Empty.play?.({ canvasElement: container });
    expect(screen.getByText("No alarms")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ New Alarm" })).toBeInTheDocument();
  });

  it("MixedList renders repeat, one-shot, and disabled rows", async () => {
    const { container } = render(<MixedList />);
    await MixedList.play?.({ canvasElement: container });
    expect(screen.getByText("Weekdays, 7:30 AM")).toBeInTheDocument();
    expect(screen.getByText("Today, 3:00 PM")).toBeInTheDocument();
    expect(screen.getByText("Off")).toBeInTheDocument();
  });

  it("EditorOpen expands the inline editor via the row tap", async () => {
    const { container } = render(<EditorOpen />);
    await EditorOpen.play?.({ canvasElement: container });
    expect(screen.getByRole("listbox", { name: "Hour" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "AM" })).toBeInTheDocument();
  });

  it("Firing renders the accent Stop bar and Stop dismisses", async () => {
    const { container } = render(<Firing />);
    await Firing.play?.({ canvasElement: container });
    expect(screen.getByRole("alert")).toHaveTextContent("Alarm — 7:30 AM · Wake up");
  });
});
