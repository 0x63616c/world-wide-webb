/**
 * Vitest component tests for WakesTileView stories.
 * Uses composeStories to execute each story (including play functions) in jsdom.
 */

import "@testing-library/jest-dom";
import { composeStories } from "@storybook/react-vite";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as stories from "../WakesTileView.stories";

const { Populated, NoneYet, Loading } = composeStories(stories);

afterEach(cleanup);

describe("WakesTileView stories", () => {
  it("Populated: count + last-wake label", async () => {
    const { container } = render(<Populated />);
    if (Populated.play) await Populated.play({ canvasElement: container });
    expect(screen.getByText("Activity")).toBeDefined();
  });

  it("NoneYet: zero count with none-yet caption", async () => {
    const { container } = render(<NoneYet />);
    if (NoneYet.play) await NoneYet.play({ canvasElement: container });
    expect(screen.getByText(/none yet/)).toBeDefined();
  });

  it("Loading: renders skeletons, no count", async () => {
    const { container } = render(<Loading />);
    if (Loading.play) await Loading.play({ canvasElement: container });
    expect(container.querySelector(".tile")).toBeTruthy();
    expect(screen.queryByText(/last /)).toBeNull();
  });
});
