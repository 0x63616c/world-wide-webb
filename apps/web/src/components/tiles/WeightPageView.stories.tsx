/**
 * Stories for WeightPageView — the Trend page body behind the Weight tile
 * (hosted by TileDetailHost). Mounted in a page-sized container matching the
 * host's padded scroll region so the flex-filled chart renders as on-panel.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import { modalDocsParameters } from "./__stories__/factory";
import { WeightPageView } from "./WeightPageView";

// 30 daily medians (lb), oldest → newest.
const DAILY = [
  186.2, 185.8, 186.0, 185.4, 185.1, 185.5, 184.8, 184.4, 183.9, 183.2, 183.6, 182.8, 183.0, 182.1,
  182.5, 181.9, 182.3, 181.4, 181.7, 180.8, 181.2, 180.6, 181.0, 180.3, 179.9, 180.6, 179.7, 180.1,
].map((lb, i) => ({ day: `2026-06-${String(22 + i).padStart(2, "0")}`, lb }));

const meta = {
  title: "Pages/WeightTrend",
  component: WeightPageView,
  tags: ["autodocs"],
  parameters: { ...modalDocsParameters(), boardWrapper: false, layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div
        style={{ height: "100vh", background: "var(--bg)", boxSizing: "border-box", padding: 24 }}
      >
        <Story />
      </div>
    ),
  ],
  args: { onRangeChange: fn() },
} satisfies Meta<typeof WeightPageView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  args: {
    status: "populated",
    range: "30d",
    lb: 180.1,
    daily: DAILY,
    low: 179.7,
    high: 186.2,
    average: 182.4,
    change: -6.1,
    windowLabel: "Jun 22 – Today",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("180.1")).toBeInTheDocument();
    expect(canvas.getByText("Low")).toBeInTheDocument();
    expect(canvas.getByText("-6.1 lb")).toBeInTheDocument();
    expect(canvas.getByText("Jun 22 – Today")).toBeInTheDocument();
  },
};

export const Loading: Story = {
  args: { status: "loading", range: "30d" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.queryByText("Low")).not.toBeInTheDocument();
  },
};

// Day one: populated status but no included readings yet → skeleton.
export const Empty: Story = {
  args: { status: "populated", range: "30d" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.queryByText("Low")).not.toBeInTheDocument();
  },
};
