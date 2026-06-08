/**
 * Vitest component tests for MinimapView stories.
 * Uses composeStories to execute each story (including play functions) in jsdom.
 */

import "@testing-library/jest-dom";
import { composeStories } from "@storybook/react-vite";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as stories from "../MinimapView.stories";

const { CenteredView, PannedToEdge, TileFocused, Visible, FadedOut } = composeStories(stories);

afterEach(cleanup);

describe("MinimapView stories — CenteredView", () => {
  it("renders the world area and viewport indicator, no hover label", async () => {
    const { container } = render(<CenteredView />);
    if (CenteredView.play) await CenteredView.play({ canvasElement: container });
    expect(container.querySelector("[data-testid='minimap-world']")).toBeInTheDocument();
    expect(container.querySelector("[data-testid='minimap-viewport']")).toBeInTheDocument();
    expect(container.querySelector("[data-testid='minimap-label']")).not.toBeInTheDocument();
  });
});

describe("MinimapView stories — PannedToEdge", () => {
  it("renders world area and viewport indicator positioned toward the right edge", async () => {
    const { container } = render(<PannedToEdge />);
    if (PannedToEdge.play) await PannedToEdge.play({ canvasElement: container });
    expect(container.querySelector("[data-testid='minimap-world']")).toBeInTheDocument();
    const vp = container.querySelector("[data-testid='minimap-viewport']") as HTMLElement | null;
    expect(vp).toBeInTheDocument();
    // Viewport indicator should be positioned beyond the halfway point of the world.
    const vpLeft = Number.parseFloat(vp?.style.left ?? "0");
    expect(vpLeft).toBeGreaterThan(90); // > half of 180px WORLD_VIEW_W
  });
});

describe("MinimapView stories — TileFocused", () => {
  it("renders world area, viewport indicator, and the hovered tile label", async () => {
    const { container } = render(<TileFocused />);
    if (TileFocused.play) await TileFocused.play({ canvasElement: container });
    expect(container.querySelector("[data-testid='minimap-world']")).toBeInTheDocument();
    expect(container.querySelector("[data-testid='minimap-viewport']")).toBeInTheDocument();
    const label = container.querySelector("[data-testid='minimap-label']");
    expect(label).toBeInTheDocument();
    expect(label?.textContent).toBe("Weather");
  });
});

describe("MinimapView stories — Visible", () => {
  it("renders with opacity 1 when shown is true", async () => {
    const { container } = render(<Visible />);
    if (Visible.play) await Visible.play({ canvasElement: container });
    const root = container.querySelector("[data-testid='minimap-root']") as HTMLElement | null;
    expect(root).toBeInTheDocument();
    expect(root?.style.opacity).toBe("1");
  });
});

describe("MinimapView stories — FadedOut", () => {
  it("renders with opacity 0 when shown is false, DOM nodes still present", async () => {
    const { container } = render(<FadedOut />);
    if (FadedOut.play) await FadedOut.play({ canvasElement: container });
    const root = container.querySelector("[data-testid='minimap-root']") as HTMLElement | null;
    expect(root).toBeInTheDocument();
    expect(root?.style.opacity).toBe("0");
    expect(container.querySelector("[data-testid='minimap-world']")).toBeInTheDocument();
    expect(container.querySelector("[data-testid='minimap-viewport']")).toBeInTheDocument();
  });
});
