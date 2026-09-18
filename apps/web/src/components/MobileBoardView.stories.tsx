/**
 * Stories for MobileBoardView , the phone view's column (see MobileBoard.tsx).
 *
 * Framed at iPhone size rather than the wall panel, because the whole point of
 * this view is the viewport the board cannot serve. The cards hold the REAL tile
 * faces (ControlsTileView / ClimateTileView, driven by props exactly as their own
 * stories drive them), so this story shows what a phone actually renders, not a
 * mock of it , and it is where you check that a tile face designed against a 4x3
 * board cell still reads at ~360px wide.
 */

import { ClimateTileView } from "@features/ac/web";
import { ControlsTileView } from "@features/ctrl/web";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import { tilePixelSize } from "../lib/grid-constants";
import { MobileBoardView } from "./MobileBoard";

// The panel footprint both tiles carry in their manifests (4x3 cells), so the
// cards are proportioned exactly like the container computes them from the
// registry , no hand-typed ratio to drift.
const { width, height } = tilePixelSize(4, 3);
const ASPECT = width / height;

// A phone frame. Declared here rather than reusing a stock preset so the story
// is pinned to one size regardless of which device list Storybook ships.
const PHONE_VIEWPORT = {
  phone: {
    name: "iPhone · 393×852",
    styles: { width: "393px", height: "852px" },
    type: "mobile" as const,
  },
};

const meta = {
  title: "Components/Mobile Board",
  component: MobileBoardView,
  tags: ["autodocs"],
  parameters: {
    // The view is position:fixed;inset:0 and owns its own background, so the
    // preview's padded board wrapper would only inset it from the frame.
    boardWrapper: false,
    viewport: { options: PHONE_VIEWPORT },
  },
  globals: { viewport: { value: "phone", isRotated: false } },
} satisfies Meta<typeof MobileBoardView>;

export default meta;
type Story = StoryObj<typeof meta>;

// The live phone view: quick Controls, then Climate · A/C, nothing else.
export const Phone: Story = {
  args: {
    tiles: [
      {
        id: "tile_ctrl",
        label: "Controls",
        aspect: ASPECT,
        onOpen: fn(),
        content: (
          <ControlsTileView
            status="populated"
            data={{
              lamps: { on: true, sub: "Mood", brightness: 60, activeScene: "mood" },
              lights: { on: false },
              fan: { on: true, sub: "On" },
            }}
            onToggle={fn()}
            onMore={fn()}
          />
        ),
      },
      {
        id: "tile_ac",
        label: "Climate · A/C",
        aspect: ASPECT,
        onOpen: fn(),
        content: (
          <ClimateTileView
            status="populated"
            mode="cool"
            target={70}
            ambient={74}
            action="Cooling"
            onSetMode={fn()}
            onSetTarget={fn()}
            onSetRange={fn()}
          />
        ),
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Each card is the tile's own tap surface, named for what it opens.
    await expect(canvas.getByRole("button", { name: "Open Controls" })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Open Climate · A/C" })).toBeInTheDocument();
    // Both real faces mounted, at phone width.
    await expect(canvas.getByText("Controls")).toBeInTheDocument();
    await expect(canvas.getByText("Climate · A/C")).toBeInTheDocument();
    // The tile faces' own controls are still reachable (the card's tap capture
    // must not swallow them).
    await expect(canvas.getByRole("button", { name: "More" })).toBeInTheDocument();
  },
};

// A phone view with nothing resolvable in the registry. Not a state anyone
// should see (the unit test fails the build first), but the column must render
// as an empty screen rather than throwing.
export const NoTiles: Story = {
  args: { tiles: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("button")).not.toBeInTheDocument();
  },
};
