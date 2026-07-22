/**
 * Stories for WeightTileView — all visual states so addon-vitest runs them as
 * component tests. Fixture numbers are plausible daily weigh-ins (lb).
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { defineTileMeta } from "./__stories__/factory";
import { formatRecency, WeightTileView } from "./WeightTileView";

const meta = {
  ...defineTileMeta("WeightTileView", WeightTileView),
} satisfies Meta<typeof WeightTileView>;

export default meta;
type Story = StoryObj<typeof meta>;

// 30 days of daily-median lb values, oldest → newest (trend gently down).
const SPARK = [
  186.2, 185.8, 186.0, 185.4, 185.1, 185.5, 184.8, 184.4, 183.9, 183.2, 183.6, 182.8, 183.0, 182.1,
  182.5, 181.9, 182.3, 181.4, 181.7, 180.8, 181.2, 180.6, 181.0, 180.3, 179.9, 180.6, 179.7, 180.1,
];

export const Loading: Story = {
  args: { status: "loading" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("Weight")).toBeInTheDocument();
    expect(canvas.queryByText(/lb/)).not.toBeInTheDocument();
  },
};

export const ErrorState: Story = {
  name: "Error",
  args: { status: "error" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("Weight")).toBeInTheDocument();
  },
};

export const Populated: Story = {
  args: {
    status: "populated",
    lb: 180.1,
    recencyLabel: "Today",
    deltaLb30: -6.1,
    spark: SPARK,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("180.1")).toBeInTheDocument();
    expect(canvas.getByText("Today")).toBeInTheDocument();
    expect(canvas.getByText(/6\.1 lb \/ 30d/)).toBeInTheDocument();
  },
};

// Weight trending UP — badge goes muted ink, not accent.
export const DeltaUp: Story = {
  args: {
    status: "populated",
    lb: 183.4,
    recencyLabel: "Yesterday",
    deltaLb30: 2.3,
    spark: [...SPARK].reverse(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText(/2\.3 lb \/ 30d/)).toBeInTheDocument();
  },
};

// Populated status but no data yet (day one, nothing ingested) → skeleton.
export const Empty: Story = {
  args: { status: "populated" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("Weight")).toBeInTheDocument();
    expect(canvas.queryByText(/lb/)).not.toBeInTheDocument();
  },
};

// A single weigh-in: no delta window yet, spark of one point.
export const FirstReading: Story = {
  args: {
    status: "populated",
    lb: 180.1,
    recencyLabel: "Today",
    spark: [180.1],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("180.1")).toBeInTheDocument();
    expect(canvas.queryByText(/30d/)).not.toBeInTheDocument();
  },
};

export const RecencyFormat: Story = {
  args: { status: "loading" },
  play: async () => {
    const now = new Date("2026-07-21T18:00:00");
    expect(formatRecency("2026-07-21T07:12:00", now)).toBe("Today");
    expect(formatRecency("2026-07-20T22:40:00", now)).toBe("Yesterday");
    expect(formatRecency("2026-07-12T07:00:00", now)).toBe("Jul 12");
  },
};
