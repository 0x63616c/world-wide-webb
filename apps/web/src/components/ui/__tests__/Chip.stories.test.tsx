/**
 * Vitest component tests for Chip stories.
 * Uses composeStories to execute each story (including play functions) in jsdom.
 */

import "@testing-library/jest-dom";
import { composeStories } from "@storybook/react-vite";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as stories from "../Chip.stories";

const { Inactive, Active, Interactive } = composeStories(stories);

afterEach(cleanup);

describe("Chip stories — Inactive", () => {
  it("renders a button with the chip class but not the on class", async () => {
    const { container } = render(<Inactive />);
    if (Inactive.play) await Inactive.play({ canvasElement: container });
    const btn = screen.getByRole("button", { name: "Inactive" });
    expect(btn).toBeInTheDocument();
    expect(btn.classList.contains("chip")).toBe(true);
    expect(btn.classList.contains("on")).toBe(false);
  });
});

describe("Chip stories — Active", () => {
  it("renders a button with both chip and on classes", async () => {
    const { container } = render(<Active />);
    if (Active.play) await Active.play({ canvasElement: container });
    const btn = screen.getByRole("button", { name: "Active" });
    expect(btn).toBeInTheDocument();
    expect(btn.classList.contains("chip")).toBe(true);
    expect(btn.classList.contains("on")).toBe(true);
  });
});

describe("Chip stories — Interactive", () => {
  it("calls onClick when the button is clicked", async () => {
    const { container } = render(<Interactive />);
    if (Interactive.play) await Interactive.play({ canvasElement: container });
    // The play function clicks the button and asserts onClick was called — if it throws,
    // the test fails. We also confirm the button itself rendered.
    expect(screen.getByRole("button", { name: "Click me" })).toBeInTheDocument();
  });
});
