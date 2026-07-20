import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactElement } from "react";
import { tilePixelSize } from "@/lib/grid-constants";
import { MinimalMarkV2A } from "./MinimalMarkV2A";
import { MinimalMarkV2B } from "./MinimalMarkV2B";
import { MinimalMarkV2C } from "./MinimalMarkV2C";
import { MinimalMarkV2D } from "./MinimalMarkV2D";

// V2 refinements of design 01 "Minimal Mark", now mostly at 1x1. Like the sibling
// PhotoBoothTileDesigns stories, these have no registry entry to size from, so we
// opt out of the BoardDecorator (boardWrapper: false) and frame each design at its
// intended cols×rows footprint using the real board cell math, on the board bg.
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
  title: "PhotoBoothDesigns/Tiles V2",
  tags: ["autodocs"],
  parameters: {
    boardWrapper: false,
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const BareGlyph: Story = {
  name: "A Bare glyph (1x1)",
  render: () => frame(<MinimalMarkV2A />, 1, 1),
};

export const FramedReady: Story = {
  name: "B Framed + ready (1x1)",
  render: () => frame(<MinimalMarkV2B />, 1, 1),
};

export const ChipLabel: Story = {
  name: "C Chip + label (1x1)",
  render: () => frame(<MinimalMarkV2C />, 1, 1),
};

export const Booth: Story = {
  name: "D Booth (2x2)",
  render: () => frame(<MinimalMarkV2D />, 2, 2),
};
