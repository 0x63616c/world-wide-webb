import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactElement } from "react";
import { tilePixelSize } from "@/lib/grid-constants";
import { TileDesign01 } from "./TileDesign01";
import { TileDesign02 } from "./TileDesign02";
import { TileDesign03 } from "./TileDesign03";
import { TileDesign04 } from "./TileDesign04";
import { TileDesign05 } from "./TileDesign05";
import { TileDesign06 } from "./TileDesign06";
import { TileDesign07 } from "./TileDesign07";
import { TileDesign08 } from "./TileDesign08";
import { TileDesign09 } from "./TileDesign09";
import { TileDesign10 } from "./TileDesign10";

// These are design prototypes for a not-yet-registered "Photo booth" tile, so
// they have no registry entry for the BoardDecorator to size from. We opt out of
// that decorator (boardWrapper: false) and frame each design at its intended
// cols×rows footprint using the real board cell math, dropped on the board bg.
function frame(node: ReactElement, cols: number, rows: number) {
  const { width, height } = tilePixelSize(cols, rows);
  return (
    <div
      className="e-root"
      style={{ background: "var(--bg)", padding: 28, display: "inline-block" }}
    >
      <div style={{ width, height }}>{node}</div>
    </div>
  );
}

const meta = {
  title: "PhotoBoothDesigns/Tiles",
  tags: ["autodocs"],
  parameters: {
    boardWrapper: false,
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const MinimalMark: Story = {
  name: "01 Minimal Mark (2x2)",
  render: () => frame(<TileDesign01 />, 2, 2),
};

export const Shutter: Story = {
  name: "02 Shutter (3x2)",
  render: () => frame(<TileDesign02 />, 3, 2),
};

export const PolaroidStack: Story = {
  name: "03 Polaroid Stack (4x3)",
  render: () => frame(<TileDesign03 />, 4, 3),
};

export const Viewfinder: Story = {
  name: "04 Viewfinder (4x4)",
  render: () => frame(<TileDesign04 />, 4, 4),
};

export const Filmstrip: Story = {
  name: "05 Filmstrip (5x3)",
  render: () => frame(<TileDesign05 />, 5, 3),
};

export const Marquee: Story = {
  name: "06 Marquee (6x4)",
  render: () => frame(<TileDesign06 />, 6, 4),
};

export const Tally: Story = {
  name: "07 Tally (2x3)",
  render: () => frame(<TileDesign07 />, 2, 3),
};

export const AuroraGlass: Story = {
  name: "08 Aurora Glass (4x3)",
  render: () => frame(<TileDesign08 />, 4, 3),
};

export const StickerParty: Story = {
  name: "09 Sticker Party (3x3)",
  render: () => frame(<TileDesign09 />, 3, 3),
};

export const TheBooth: Story = {
  name: "10 The Booth (4x4)",
  render: () => frame(<TileDesign10 />, 4, 4),
};
