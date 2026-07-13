import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import { defineTileMeta } from "./__stories__/factory";
import { FrontendLogsTileView } from "./FrontendLogsTileView";

/** Quiet day with one incident spike late in the window. */
const INCIDENT_BUCKETS = [
  0, 0, 1, 0, 0, 0, 0, 2, 0, 0, 1, 0, 0, 0, 3, 1, 0, 0, 2, 5, 18, 41, 24, 8,
].map((error, i) => ({ error, warn: i % 5 === 0 ? 1 : 0 }));

/** Steady warn hum, occasional error , what a healthy panel looks like. */
const STEADY_BUCKETS = Array.from({ length: 24 }, (_, i) => ({
  warn: 8 + ((i * 7) % 9),
  error: i % 7 === 3 ? 1 : 0,
}));

const meta = {
  ...defineTileMeta("FrontendLogsTileView", FrontendLogsTileView),
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof FrontendLogsTileView>;

export default meta;
type Story = StoryObj<typeof meta>;

// An incident: error histogram spikes, tally shows the damage
export const Incident: Story = {
  args: {
    status: "populated",
    counts: { debug: 1, info: 3, warn: 15, error: 106 },
    buckets: INCIDENT_BUCKETS,
    onTileTap: fn(),
  },
  play: async ({ args, canvasElement, userEvent }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Frontend Logs")).toBeInTheDocument();
    await expect(canvas.getByText("106 errors")).toBeInTheDocument();
    await expect(canvas.getByText("15 warn")).toBeInTheDocument();
    await expect(canvas.getByText("1 debug")).toBeInTheDocument();
    // Tap anywhere on the tile opens the logs modal (wired by the container)
    await userEvent.click(canvas.getByText("Frontend Logs"));
    if (args.status !== "populated") throw new Error("story args must be populated");
    await expect(args.onTileTap).toHaveBeenCalled();
  },
};

// Healthy: steady warn hum, tally counts abbreviate past 10k
export const Steady: Story = {
  args: {
    status: "populated",
    counts: { debug: 4210, info: 18400, warn: 312, error: 12 },
    buckets: STEADY_BUCKETS,
    onTileTap: fn(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("12 errors")).toBeInTheDocument();
    await expect(canvas.getByText("18k info")).toBeInTheDocument();
    await expect(canvas.getByText("4,210 debug")).toBeInTheDocument();
  },
};

// Nothing logged in 24h: every hour renders its 2px stub, tally all zero
export const Silent: Story = {
  args: {
    status: "populated",
    counts: { debug: 0, info: 0, warn: 0, error: 0 },
    buckets: Array.from({ length: 24 }, () => ({ warn: 0, error: 0 })),
    onTileTap: fn(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("0 errors")).toBeInTheDocument();
    // 24 hourly slots render even with nothing to show
    const chart = canvasElement.querySelector("[data-testid='logs-histogram']");
    await expect(chart?.childElementCount).toBe(24);
  },
};

// First paint before the initial store walk lands
export const Loading: Story = {
  args: {
    status: "loading",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Frontend Logs")).toBeInTheDocument();
    await expect(canvas.queryByText(/errors/)).not.toBeInTheDocument();
  },
};
