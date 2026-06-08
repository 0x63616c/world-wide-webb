/**
 * Vitest component tests for Pill stories.
 * Uses composeStories to execute each story (including play functions) in jsdom.
 */

import "@testing-library/jest-dom";
import { composeStories } from "@storybook/react-vite";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as stories from "../Pill.stories";

const { Default, On, Amber } = composeStories(stories);

afterEach(cleanup);

describe("Pill stories — Default", () => {
  it("renders a span with class pill and no tone modifier", async () => {
    const { container } = render(<Default />);
    if (Default.play) await Default.play({ canvasElement: container });
    const pill = screen.getByText("Default");
    expect(pill).toBeInTheDocument();
    expect(pill.classList.contains("pill")).toBe(true);
    expect(pill.className.trim()).toBe("pill");
  });
});

describe("Pill stories — On", () => {
  it("renders a span with classes pill and on", async () => {
    const { container } = render(<On />);
    if (On.play) await On.play({ canvasElement: container });
    const pill = screen.getByText("On");
    expect(pill).toBeInTheDocument();
    expect(pill.classList.contains("pill")).toBe(true);
    expect(pill.classList.contains("on")).toBe(true);
  });
});

describe("Pill stories — Amber", () => {
  it("renders a span with classes pill and amber", async () => {
    const { container } = render(<Amber />);
    if (Amber.play) await Amber.play({ canvasElement: container });
    const pill = screen.getByText("Amber");
    expect(pill).toBeInTheDocument();
    expect(pill.classList.contains("pill")).toBe(true);
    expect(pill.classList.contains("amber")).toBe(true);
  });
});
