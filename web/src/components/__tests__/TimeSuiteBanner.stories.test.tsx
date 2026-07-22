/**
 * Vitest smoke tests for TimeSuiteBanner stories , composeStories executes
 * each story's play assertions (Stop vs body-tap routing) in jsdom.
 */

import "@testing-library/jest-dom";
import { composeStories } from "@storybook/react-vite";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as stories from "../TimeSuiteBanner.stories";

const { TimerDone, AlarmFiring } = composeStories(stories);

afterEach(cleanup);

describe("TimeSuiteBanner stories", () => {
  it("TimerDone renders the amber nag and Stop routes to onStop", async () => {
    const { container } = render(<TimerDone />);
    await TimerDone.play?.({ canvasElement: container });
    expect(screen.getByText(/timer done/i)).toBeInTheDocument();
  });

  it("AlarmFiring renders the assertive alert and a body tap routes to onOpen", async () => {
    const { container } = render(<AlarmFiring />);
    await AlarmFiring.play?.({ canvasElement: container });
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
