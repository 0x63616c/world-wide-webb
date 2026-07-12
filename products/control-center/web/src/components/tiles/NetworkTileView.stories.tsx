import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { defineTileMeta } from "./__stories__/factory";
import { NetworkTileView } from "./NetworkTileView";

// 24 buckets mirrors real API shape , enough for the butterfly chart to render fully
const SAMPLE_TRAFFIC = Array.from({ length: 24 }, (_, i) => ({
  down: i % 3 === 0 ? 0.8 : 0.4,
  up: i % 4 === 0 ? 0.3 : 0.15,
}));

const meta = {
  ...defineTileMeta("NetworkTileView", NetworkTileView),
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof NetworkTileView>;

export default meta;
type Story = StoryObj<typeof meta>;

// Online connection with traffic history
export const Populated: Story = {
  args: {
    status: "populated",
    isOffline: false,
    down: "14.2",
    up: "3.8",
    ssid: "world-wide-webb",
    ping: 12,
    traffic: SAMPLE_TRAFFIC,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/↓ 14\.2 GB/)).toBeInTheDocument();
    await expect(canvas.getByText(/↑ 3\.8 GB/)).toBeInTheDocument();
    await expect(canvas.getByText("world-wide-webb")).toBeInTheDocument();
    await expect(canvas.getByText("12ms")).toBeInTheDocument();
  },
};

// Offline , StatusDot renders gray dot instead of green dot
export const Offline: Story = {
  args: {
    status: "populated",
    isOffline: true,
    down: "0.0",
    up: "0.0",
    ssid: "world-wide-webb",
    ping: 999,
    traffic: SAMPLE_TRAFFIC,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("world-wide-webb")).toBeInTheDocument();
    await expect(canvas.getByText("999ms")).toBeInTheDocument();
    // Offline label is never rendered , only the StatusDot color changes
    await expect(canvas.queryByText("Offline")).not.toBeInTheDocument();
    // Offline StatusDot renders inline-styled span , no .dot class (that only appears online)
    await expect(canvasElement.querySelector(".dot")).toBeNull();
  },
};

// Traffic array empty → Skeleton renders in place of ButterflyChart
export const EmptyTraffic: Story = {
  args: {
    status: "populated",
    isOffline: false,
    down: "0.0",
    up: "0.0",
    ssid: "world-wide-webb",
    ping: 4,
    traffic: [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/↓ 0\.0 GB/)).toBeInTheDocument();
    // No chart buckets when traffic is empty
    const buckets = canvasElement.querySelectorAll(
      "[style*='position: relative'][style*='flex: 1']",
    );
    await expect(buckets.length).toBe(0);
  },
};

// Loading/skeleton state , shown before first data arrives
export const Loading: Story = {
  args: {
    status: "loading",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Down/up labels must not appear while loading
    await expect(canvas.queryByText(/↓/)).not.toBeInTheDocument();
    await expect(canvas.queryByText(/↑/)).not.toBeInTheDocument();
  },
};
