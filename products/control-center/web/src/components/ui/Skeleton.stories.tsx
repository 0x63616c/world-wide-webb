import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { Skeleton } from "./Skeleton";

const meta = {
  title: "UI/Skeleton",
  component: Skeleton,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div style={{ padding: 16, background: "var(--tile-1, #111)", borderRadius: 12 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

// Default: a single text-line-height bar (h defaults to 14).
export const Default: Story = {
  args: { w: 120 },
  play: async ({ canvasElement }) => {
    const el = canvasElement.querySelector("[data-skeleton]");
    await expect(el).not.toBeNull();
  },
};

// Line: typical body-text replacement , narrow, full label width.
export const Line: Story = {
  args: { w: 200, h: 14 },
  play: async ({ canvasElement }) => {
    const el = canvasElement.querySelector("[data-skeleton]");
    await expect(el).not.toBeNull();
  },
};

// Block: card / image placeholder , wider, taller, rounded.
export const Block: Story = {
  args: { w: 200, h: 80, borderRadius: 12 },
  play: async ({ canvasElement }) => {
    const el = canvasElement.querySelector("[data-skeleton]");
    await expect(el).not.toBeNull();
  },
};

// PercentageWidth: w as a CSS string (fills parent).
export const PercentageWidth: Story = {
  args: { w: "100%", h: 18 },
  play: async ({ canvasElement }) => {
    const el = canvasElement.querySelector("[data-skeleton]");
    await expect(el).not.toBeNull();
  },
};
