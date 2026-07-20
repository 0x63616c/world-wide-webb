/**
 * Aperture V2 , four refined variations of the chosen "Aperture" photo-booth
 * camera (design 01). Each keeps Aperture's edge-to-edge preview, ring shutter,
 * flash toggle, close button and countdown overlay, and applies the user's
 * feedback: an icon-led self-timer (no bare "Off"), a filter *menu* instead of
 * an always-visible swatch ramp, a house-styled gallery button, and a bottom
 * cluster lifted off the panel edge. They differ in how the timer and the
 * filter menu are presented; all reuse the app's real UI primitives + tokens.
 *
 * Throwaway exploration surfaces , the user picks one. Pinned to the fixed
 * 1366×1024 wall panel; the shared CameraStage paints a fallback where CI has
 * no camera so every story still renders.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentType } from "react";
import { ApertureV2A } from "./ApertureV2A";
import { ApertureV2B } from "./ApertureV2B";
import { ApertureV2C } from "./ApertureV2C";
import { ApertureV2D } from "./ApertureV2D";
import { ApertureV3 } from "./ApertureV3";

/** Fixed wall-panel stage , every variation is pinned to exactly 1366×1024. */
function Stage({ Design }: { Design: ComponentType }) {
  return (
    <div style={{ width: 1366, height: 1024, position: "relative", overflow: "hidden" }}>
      <Design />
    </div>
  );
}

const meta: Meta<typeof Stage> = {
  title: "PhotoBoothDesigns/Camera V2",
  tags: ["autodocs"],
  component: Stage,
  parameters: {
    layout: "fullscreen",
    // Opt out of the board-sizing decorator , these fill the panel themselves.
    boardWrapper: false,
  },
};

export default meta;

type Story = StoryObj<typeof Stage>;

export const Sheet: Story = {
  name: "A Sheet (segmented timer + filter sheet)",
  render: () => <Stage Design={ApertureV2A} />,
};

export const Pillbox: Story = {
  name: "B Pillbox (cycling timer + filter popover)",
  render: () => <Stage Design={ApertureV2B} />,
};

export const Panel: Story = {
  name: "C Panel (expanding timer + filter modal)",
  render: () => <Stage Design={ApertureV2C} />,
};

export const Strip: Story = {
  name: "D Strip (timer dropdown + filter side-strip)",
  render: () => <Stage Design={ApertureV2D} />,
};

export const Final: Story = {
  name: "E Final (cycling timer · filter/timer/flash top right)",
  render: () => <Stage Design={ApertureV3} />,
};
