import { DogCamTileView } from "@features/dogcam/web";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { boolArgType, defineTileMeta } from "./__stories__/factory";

/** The api proxies go2rtc's MJPEG stream at this path (see nginx.conf / vite.config.ts). */
const STREAM_URL = "/media/camera-stream";

const meta = {
  ...defineTileMeta("DogCamTileView", DogCamTileView),
  args: {
    status: "populated",
    label: "Living Room Cam",
    online: true,
    snapshotUrl: null,
    streamUrl: null,
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
    streamUrl: {
      control: "text",
      description: "MJPEG stream URL , the img is only mounted (fetched) while live is true",
    },
    label: {
      control: "text",
      description: "Camera label",
    },
    recSecs: {
      control: { type: "number", min: 0, step: 1 },
      description: "Elapsed recording seconds (shown as HH:MM:SS in live mode)",
    },
  },
} satisfies Meta<typeof DogCamTileView>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default covered state , camera is online, feed hidden. The stream img is NOT
 * mounted, so no MJPEG connection is opened until the user taps.
 */
export const Covered: Story = {
  args: {
    status: "populated",
    label: "Living Room Cam",
    online: true,
    snapshotUrl: null,
    streamUrl: STREAM_URL,
    live: false,
    recSecs: 0,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Header title and the cover label both read "Living Room Cam".
    await expect(canvas.getAllByText("Living Room Cam").length).toBeGreaterThanOrEqual(2);
    await expect(canvas.getByText(/tap to view feed/i)).toBeInTheDocument();
    await expect(canvas.queryByText("LIVE")).not.toBeInTheDocument();
    // No stream img while covered , the connection must not be open.
    await expect(canvas.queryByRole("img")).not.toBeInTheDocument();
    const btn = canvas.getByRole("button", { name: /view camera feed/i });
    await expect(btn).toBeInTheDocument();
  },
};

/** Camera offline , covered state shows "Camera offline" instead of tap prompt. */
export const Offline: Story = {
  args: {
    status: "populated",
    label: "Living Room Cam",
    online: false,
    snapshotUrl: null,
    streamUrl: null,
    live: false,
    recSecs: 0,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
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
    streamUrl: null,
    live: false,
    recSecs: 0,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Living Room Cam")).toBeInTheDocument();
    // Feed button is present but no tap-prompt text while loading
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
    streamUrl: null,
    live: false,
    recSecs: 0,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Header still visible; no data rendered while tile retries
    await expect(canvas.getByText("Living Room Cam")).toBeInTheDocument();
    await expect(canvas.getByRole("button")).toBeInTheDocument();
    await expect(canvas.queryByText(/tap to view feed/i)).not.toBeInTheDocument();
    await expect(canvas.queryByText(/camera offline/i)).not.toBeInTheDocument();
    await expect(canvas.queryByText("LIVE")).not.toBeInTheDocument();
  },
};

/**
 * Live state , the MJPEG stream img is mounted, LIVE badge and REC timer show.
 * An MJPEG multipart response renders natively in an <img>, no player needed.
 */
export const Live: Story = {
  args: {
    status: "populated",
    label: "Living Room Cam",
    online: true,
    snapshotUrl: null,
    streamUrl: STREAM_URL,
    live: true,
    recSecs: 75,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("LIVE")).toBeInTheDocument();
    // 75 seconds = 00:01:15
    await expect(canvas.getByText(/^REC 00:01:15$/)).toBeInTheDocument();
    // The live stream img is mounted and points at the api proxy
    await expect(canvas.getByRole("img")).toHaveAttribute("src", STREAM_URL);
    // Frosted cover is gone
    await expect(canvas.queryByText(/tap to view feed/i)).not.toBeInTheDocument();
    // Feed button aria-label reflects live state
    await expect(canvas.getByRole("button", { name: /hide camera feed/i })).toBeInTheDocument();
  },
};

/** Snapshot poster , an img is rendered when snapshotUrl is provided, even while covered. */
export const WithSnapshot: Story = {
  args: {
    status: "populated",
    label: "Front Door",
    online: true,
    snapshotUrl: "https://picsum.photos/seed/dogcam/640/360",
    streamUrl: null,
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
    label: "Living Room Cam",
    online: true,
    snapshotUrl: null,
    streamUrl: STREAM_URL,
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
