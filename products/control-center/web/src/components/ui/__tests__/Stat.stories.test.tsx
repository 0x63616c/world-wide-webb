/**
 * Vitest component tests for Stat stories.
 * Uses composeStories to execute each story (including play functions) in jsdom.
 */

import "@testing-library/jest-dom";
import { composeStories } from "@storybook/react-vite";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as stories from "../Stat.stories";

const { Default, Accent, Muted, WithSub } = composeStories(stories);

afterEach(cleanup);

describe("Stat stories , Default", () => {
  it("renders label and value text and the data-stat-value element", async () => {
    const { container } = render(<Default />);
    if (Default.play) await Default.play({ canvasElement: container });
    expect(screen.getByText("Temperature")).toBeInTheDocument();
    expect(screen.getByText("72°")).toBeInTheDocument();
    expect(container.querySelector("[data-stat-value]")).toBeInTheDocument();
  });
});

describe("Stat stories , Accent", () => {
  it("renders label and value with the data-stat-value element", async () => {
    const { container } = render(<Accent />);
    if (Accent.play) await Accent.play({ canvasElement: container });
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(container.querySelector("[data-stat-value]")).toBeInTheDocument();
  });
});

describe("Stat stories , Muted", () => {
  it("renders label and value with the data-stat-value element", async () => {
    const { container } = render(<Muted />);
    if (Muted.play) await Muted.play({ canvasElement: container });
    expect(screen.getByText("Humidity")).toBeInTheDocument();
    expect(container.querySelector("[data-stat-value]")).toBeInTheDocument();
  });
});

describe("Stat stories , WithSub", () => {
  it("renders label, value, and sub text", async () => {
    const { container } = render(<WithSub />);
    if (WithSub.play) await WithSub.play({ canvasElement: container });
    expect(screen.getByText("Wind")).toBeInTheDocument();
    expect(screen.getByText("8 mph")).toBeInTheDocument();
    expect(screen.getByText("NW gusts 12")).toBeInTheDocument();
    expect(container.querySelector("[data-stat-value]")).toBeInTheDocument();
  });
});
