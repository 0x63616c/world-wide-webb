import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import { SessionListView, type SessionSummary } from "./SessionListView";

const meta = {
  title: "Tiles/SessionListView",
  component: SessionListView,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
} satisfies Meta<typeof SessionListView>;

export default meta;
type Story = StoryObj<typeof meta>;

// Photo paths follow the real store layout (wake-photos/YYYY/MM/DD/<ts>-<n>.jpg);
// the URLs 404 in Storybook, which exercises the broken-image state the panel
// also hits while a frame is still uploading.
const T0 = Date.UTC(2026, 6, 18, 19, 4, 2);

const SESSIONS: SessionSummary[] = [
  {
    id: "isn_9f3ac1d2e4b5",
    startedAt: T0,
    endedAt: T0 + 134_000,
    durationMs: 134_000,
    eventCount: 8,
    endReason: "idle-dim",
    deviceName: "wall-panel",
    photoPaths: ["2026/07/18/1784487842000-0.jpg", "2026/07/18/1784487843300-0.jpg"],
  },
  {
    id: "isn_71b0de8c22aa",
    startedAt: T0 - 4_320_000,
    endedAt: T0 - 4_289_000,
    durationMs: 31_000,
    eventCount: 2,
    endReason: "idle-reset",
    deviceName: "wall-panel",
    photoPaths: ["2026/07/18/1784483522000-0.jpg"],
  },
  {
    id: "isn_c0ffee54d00d",
    startedAt: T0 - 90_000_000,
    endedAt: T0 - 89_940_000,
    durationMs: 60_000,
    eventCount: 5,
    endReason: "timeout",
    deviceName: "wall-panel",
    photoPaths: [],
  },
];

export const Default: Story = {
  args: {
    sessions: SESSIONS,
    photoUrl: (path) => `/media/wake-photos/${path}`,
    onSelect: fn(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByTestId("session-row")).toHaveLength(3);
    await expect(canvas.getByText(/2m 14s/)).toBeInTheDocument();
  },
};

export const Live: Story = {
  args: {
    sessions: [
      {
        ...SESSIONS[0],
        id: "isn_00aa11bb22cc",
        endedAt: null,
        durationMs: null,
        endReason: null,
        eventCount: 3,
      },
    ],
    photoUrl: (path) => `/media/wake-photos/${path}`,
    onSelect: fn(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/live/)).toBeInTheDocument();
  },
};

export const NoPhotos: Story = {
  args: {
    sessions: [SESSIONS[2]],
    photoUrl: (path) => `/media/wake-photos/${path}`,
    onSelect: fn(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("no photo")).toBeInTheDocument();
  },
};

export const Empty: Story = {
  args: {
    sessions: [],
    photoUrl: (path) => `/media/wake-photos/${path}`,
    onSelect: fn(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/No sessions yet/)).toBeInTheDocument();
    await expect(canvas.queryAllByTestId("session-row")).toHaveLength(0);
  },
};
