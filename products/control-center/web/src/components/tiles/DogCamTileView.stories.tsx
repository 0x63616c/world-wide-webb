import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { boolArgType, defineTileMeta } from "./__stories__/factory";
import { DogCamTileView } from "./DogCamTileView";

const meta = {
  ...defineTileMeta("DogCamTileView", DogCamTileView),
  args: {
    status: "populated",
    label: "Living Room",
    online: true,
    snapshotUrl: null,
    live: false,
    recSecs: 0,
    // fn() makes onToggleLive a storybook/vitest spy so play-function assertions work.
    onToggleLive: fn(),
  },
  argTypes: {
    live: boolArgType("Whether the live feed overlay is currently visible"),
    online: boolArgType("Whether the camera hardware is reachable"),
    snapshotUrl: {
      control: "text",
      description: "Snapshot image URL , null renders the dark gradient background",
    },
    label: {
      control: "text",
      description: "Camera label from Home Assistant entity",
    },
    recSecs: {
      control: { type: "number", min: 0, step: 1 },
      description: "Elapsed recording seconds (shown as HH:MM:SS in live mode)",
    },
  },
} satisfies Meta<typeof DogCamTileView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Default covered state , camera is online, snapshot unavailable, feed hidden. */
export const Covered: Story = {
  args: {
    status: "populated",
    label: "Living Room",
    online: true,
    snapshotUrl: null,
    live: false,
    recSecs: 0,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Dog Cam")).toBeInTheDocument();
    await expect(canvas.getByText("Living Room")).toBeInTheDocument();
    await expect(canvas.getByText(/tap to view feed/i)).toBeInTheDocument();
    await expect(canvas.queryByText("LIVE")).not.toBeInTheDocument();
    // Feed button has correct aria-label when not live
    const btn = canvas.getByRole("button", { name: /view camera feed/i });
    await expect(btn).toBeInTheDocument();
  },
};

/** Camera offline , covered state shows "Camera offline" instead of tap prompt. */
export const Offline: Story = {
  args: {
    status: "populated",
    label: "Backyard Cam",
    online: false,
    snapshotUrl: null,
    live: false,
    recSecs: 0,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Backyard Cam")).toBeInTheDocument();
    await expect(canvas.getByText(/camera offline/i)).toBeInTheDocument();
    await expect(canvas.queryByText(/tap to view feed/i)).not.toBeInTheDocument();
  },
};

/** Loading state , shimmer cover, no label text rendered. */
export const Loading: Story = {
  args: {
    status: "loading",
    label: undefined,
    online: undefined,
    snapshotUrl: null,
    live: false,
    recSecs: 0,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Dog Cam")).toBeInTheDocument();
    // Feed button is present but no label or tap-prompt text while loading
    await expect(canvas.getByRole("button")).toBeInTheDocument();
    await expect(canvas.queryByText(/tap to view feed/i)).not.toBeInTheDocument();
    await expect(canvas.queryByText(/camera offline/i)).not.toBeInTheDocument();
    await expect(canvas.queryByText("LIVE")).not.toBeInTheDocument();
  },
};

/** Error/empty state , component shows shimmer cover and keeps retrying via QueryClient. */
export const ErrorEmpty: Story = {
  name: "Error / empty",
  args: {
    status: "error",
    label: undefined,
    online: undefined,
    snapshotUrl: null,
    live: false,
    recSecs: 0,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Header still visible; no data rendered while tile retries
    await expect(canvas.getByText("Dog Cam")).toBeInTheDocument();
    await expect(canvas.getByRole("button")).toBeInTheDocument();
    await expect(canvas.queryByText(/tap to view feed/i)).not.toBeInTheDocument();
    await expect(canvas.queryByText(/camera offline/i)).not.toBeInTheDocument();
    await expect(canvas.queryByText("LIVE")).not.toBeInTheDocument();
  },
};

/** Live state , feed is revealed, LIVE badge and REC timer are shown. */
export const Live: Story = {
  args: {
    status: "populated",
    label: "Living Room",
    online: true,
    snapshotUrl: null,
    live: true,
    recSecs: 75,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("LIVE")).toBeInTheDocument();
    // 75 seconds = 00:01:15
    await expect(canvas.getByText(/^REC 00:01:15$/)).toBeInTheDocument();
    // Caption label is visible in live mode
    await expect(canvas.getByText("Living Room")).toBeInTheDocument();
    // Frosted cover is gone
    await expect(canvas.queryByText(/tap to view feed/i)).not.toBeInTheDocument();
    // Feed button aria-label reflects live state
    await expect(canvas.getByRole("button", { name: /hide camera feed/i })).toBeInTheDocument();
  },
};

/** Snapshot visible , an img tag is rendered when snapshotUrl is provided. */
export const WithSnapshot: Story = {
  args: {
    status: "populated",
    label: "Front Door",
    online: true,
    snapshotUrl: "https://picsum.photos/seed/dogcam/640/360",
    live: false,
    recSecs: 0,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const img = canvas.getByRole("img");
    await expect(img).toBeInTheDocument();
    await expect(img).toHaveAttribute("src", "https://picsum.photos/seed/dogcam/640/360");
  },
};

/** Interaction test , clicking the feed button fires onToggleLive spy. */
export const ToggleLiveInteraction: Story = {
  args: {
    status: "populated",
    label: "Living Room",
    online: true,
    snapshotUrl: null,
    live: false,
    recSecs: 0,
    // Per-story fn() ensures a fresh spy with no prior call history.
    onToggleLive: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const btn = canvas.getByRole("button", { name: /view camera feed/i });
    // Verify covered state before click
    await expect(canvas.getByText(/tap to view feed/i)).toBeInTheDocument();
    // Click fires onToggleLive , args.onToggleLive is a storybook/vitest spy (fn())
    await userEvent.click(btn);
    await expect(args.onToggleLive).toHaveBeenCalledTimes(1);
  },
};
