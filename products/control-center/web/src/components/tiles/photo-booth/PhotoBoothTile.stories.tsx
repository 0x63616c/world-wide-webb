/**
 * PhotoBoothTile stories , the 1x1 board face. The global BoardDecorator reads
 * the tile registry (via registryEntryForComponent) to frame it at its true
 * 1x1 wall size, so the mark + accent dot render exactly as they do on the board.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { PhotoBoothTile } from "./PhotoBoothTile";

const meta = {
  title: "Tiles/PhotoBooth/PhotoBoothTile",
  component: PhotoBoothTile,
  tags: ["autodocs"],
} satisfies Meta<typeof PhotoBoothTile>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Resting board face , camera glyph in the nest chip with the accent dot. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    // The camera glyph (lucide svg) and the accent status dot both render.
    await expect(canvasElement.querySelector(".lucide-camera")).toBeInTheDocument();
    await expect(canvasElement.querySelector(".dot")).toBeInTheDocument();
  },
};
