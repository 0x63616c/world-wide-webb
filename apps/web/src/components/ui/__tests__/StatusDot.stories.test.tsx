/**
 * Vitest component tests for StatusDot stories.
 * Uses composeStories to execute each story (including play functions) in jsdom.
 */

import "@testing-library/jest-dom";
import { composeStories } from "@storybook/react-vite";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as stories from "../StatusDot.stories";

const { Online, Offline } = composeStories(stories);

afterEach(cleanup);

describe("StatusDot stories — Online", () => {
  it("renders the .dot span", async () => {
    const { container } = render(<Online />);
    if (Online.play) await Online.play({ canvasElement: container });
    expect(container.querySelector(".dot")).toBeInTheDocument();
  });
});

describe("StatusDot stories — Offline", () => {
  it("renders a plain span without the .dot class", async () => {
    const { container } = render(<Offline />);
    if (Offline.play) await Offline.play({ canvasElement: container });
    expect(container.querySelector(".dot")).not.toBeInTheDocument();
    expect(container.querySelector("span")).toBeInTheDocument();
  });
});
