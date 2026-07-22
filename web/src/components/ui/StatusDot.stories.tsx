import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { StatusDot } from "./StatusDot";

const meta = {
  title: "UI/StatusDot",
  component: StatusDot,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div
        style={{
          padding: 16,
          background: "var(--tile-1, #111)",
          borderRadius: 12,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof StatusDot>;

export default meta;
type Story = StoryObj<typeof meta>;

// Online: renders the green `.dot` span.
export const Online: Story = {
  args: { online: true },
  play: async ({ canvasElement }) => {
    const dot = canvasElement.querySelector(".dot");
    await expect(dot).not.toBeNull();
  },
};

// Offline: no `.dot` class, but a plain inline-block span renders.
export const Offline: Story = {
  args: { online: false },
  play: async ({ canvasElement }) => {
    const dot = canvasElement.querySelector(".dot");
    await expect(dot).toBeNull();
    const span = canvasElement.querySelector("span");
    await expect(span).not.toBeNull();
  },
};
