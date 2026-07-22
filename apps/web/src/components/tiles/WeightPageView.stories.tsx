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

/** One daily point: no line is meaningful, so the chart area explains itself. */
export const SingleDay: Story = {
  args: {
    status: "populated",
    range: "all",
    lb: 160.6,
    daily: [{ day: "2026-07-22", lb: 160.6 }],
    low: 160.2,
    high: 160.9,
    average: 160.6,
    change: 0,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText(/Not enough data yet/)).toBeInTheDocument();
    // Stats still show — they are real even with one day.
    expect(canvas.getByText("160.2 lb")).toBeInTheDocument();
    expect(canvas.getByText("160.9 lb")).toBeInTheDocument();
  },
};

/** A skipped day must leave a real gap, not be drawn as an even interval. */
export const WithGap: Story = {
  args: {
    status: "populated",
    range: "30d",
    lb: 160.6,
    daily: [
      { day: "2026-07-14", lb: 162.4 },
      { day: "2026-07-15", lb: 162.2 },
      { day: "2026-07-22", lb: 160.6 },
    ],
    low: 160.2,
    high: 162.6,
    average: 161.7,
    change: -1.8,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const path = canvasElement.querySelector("svg path");
    expect(path).toBeTruthy();
    const [, second, third] = (path?.getAttribute("d") ?? "")
      .split(/[ML]/)
      .filter(Boolean)
      .map((p) => Number(p.split(",")[0]));
    // Jul 14→15 is one day; Jul 15→22 is seven. The second span must be far
    // wider than the first, which index-based spacing would make equal.
    expect((third ?? 0) - (second ?? 0)).toBeGreaterThan(((second ?? 0) - 16) * 3);
    // Axis label reflects the daily-series max (162.4), not the raw `high`
    // stat (162.6) — the two diverge on purpose once labels stop sitting on
    // the raw low/high figures.
    expect(canvas.getByText("162.4")).toBeInTheDocument();
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
