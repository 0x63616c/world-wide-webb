/**
 * PhotoBoothTile stories , the 2x2 titled board face. The global BoardDecorator
 * reads the tile registry (via registryEntryForComponent) to frame it at its true
 * 2x2 wall size, so the header, camera mark, and accent dot render exactly as they
 * do on the board.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { PhotoBoothTile } from "./PhotoBoothTile";

const meta = {
  title: "Tiles/PhotoBooth/PhotoBoothTile",
  component: PhotoBoothTile,
  tags: ["autodocs"],
} satisfies Meta<typeof PhotoBoothTile>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Resting board face , "Photo Booth" header over the camera mark. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The registry label must match this title (tile-title-sync guard).
    await expect(canvas.getByText("Photo Booth")).toBeInTheDocument();
    // The camera glyph (lucide svg) renders. No status dot is asserted , the
    // booth carries no live state, so the dot was deliberately dropped.
    await expect(canvasElement.querySelector(".lucide-camera")).toBeInTheDocument();
  },
};
