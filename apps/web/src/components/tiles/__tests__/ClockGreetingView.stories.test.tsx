/**
 * Vitest component tests for ClockGreetingView stories.
 * Uses composeStories to execute each story (including play functions) in jsdom.
 */

import { composeStories } from "@storybook/react-vite";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as stories from "../ClockGreetingView.stories";

const { Populated, Loading, Evening, Night, ErrorState, WithSecondsRing } = composeStories(stories);

afterEach(cleanup);

describe("ClockGreetingView stories", () => {
  it("Populated: renders greeting, time, date, and location", async () => {
    const { container } = render(<Populated />);
    if (Populated.play) await Populated.play({ canvasElement: container });
    expect(screen.getByText(/good morning/i)).toBeDefined();
    expect(screen.getByTestId("clock-ampm").textContent).toBe("AM");
    expect(screen.getByTestId("clock-date")).toBeDefined();
    expect(screen.getByText(/los angeles/i)).toBeDefined();
  });

  it("Loading: renders skeleton placeholders, no real time content", async () => {
    const { container } = render(<Loading />);
    if (Loading.play) await Loading.play({ canvasElement: container });
    // Assert via data-skeleton attribute — resilient to CSS refactors
    const skeletons = container.querySelectorAll("[data-skeleton]");
    expect(skeletons.length).toBeGreaterThan(0);
    expect(screen.queryByTestId("clock-ampm")).toBeNull();
  });

  it("Evening: renders 'Good evening' greeting with PM time", async () => {
    const { container } = render(<Evening />);
    if (Evening.play) await Evening.play({ canvasElement: container });
    expect(screen.getByText(/good evening/i)).toBeDefined();
    expect(screen.getByTestId("clock-ampm").textContent).toBe("PM");
  });

  it("Night: renders 'Good night' greeting", async () => {
    const { container } = render(<Night />);
    if (Night.play) await Night.play({ canvasElement: container });
    expect(screen.getByText(/good night/i)).toBeDefined();
  });

  it("ErrorState: renders skeleton fallback, no live clock content", async () => {
    const { container } = render(<ErrorState />);
    if (ErrorState.play) await ErrorState.play({ canvasElement: container });
    const skeletons = container.querySelectorAll("[data-skeleton]");
    expect(skeletons.length).toBeGreaterThan(0);
    expect(screen.queryByTestId("clock-ampm")).toBeNull();
  });

  it("WithSecondsRing: renders the seconds progress ring", async () => {
    const { container } = render(<WithSecondsRing />);
    if (WithSecondsRing.play) await WithSecondsRing.play({ canvasElement: container });
    expect(container.querySelector("[data-testid='seconds-ring']")).toBeTruthy();
  });
});
