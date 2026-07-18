import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import { type SessionDetail, SessionDetailView } from "./SessionDetailView";

const meta = {
  title: "Tiles/SessionDetailView",
  component: SessionDetailView,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
} satisfies Meta<typeof SessionDetailView>;

export default meta;
type Story = StoryObj<typeof meta>;

const T0 = Date.UTC(2026, 6, 18, 19, 4, 2);
const SID = "isn_9f3ac1d2e4b5";

const SESSION: SessionDetail = {
  id: SID,
  startedAt: T0,
  endedAt: T0 + 134_000,
  durationMs: 134_000,
  eventCount: 4,
  endReason: "idle-dim",
  deviceName: "wall-panel",
  photoPaths: [
    "2026/07/18/1784487842000-0.jpg",
    "2026/07/18/1784487843300-0.jpg",
    "2026/07/18/1784487844000-0.jpg",
  ],
  events: [
    { ts: T0, idx: 0, msg: "session/start", data: { interactionSessionId: SID } },
    { ts: T0 + 400, idx: 1, msg: "session/wake", data: { target: "panel" } },
    { ts: T0 + 4_100, idx: 2, msg: "tile/tap", data: { target: "tile_climate" } },
    { ts: T0 + 4_600, idx: 3, msg: "modal/open", data: { target: "modal.Climate" } },
    {
      ts: T0 + 21_000,
      idx: 4,
      msg: "settings/change",
      data: { target: "settings.idleDimLevel", from: 0.2, to: 0.3 },
    },
    {
      ts: T0 + 134_000,
      idx: 5,
      msg: "session/end",
      data: { reason: "idle-dim", events: 4, durationMs: 134_000 },
    },
  ],
};

export const Default: Story = {
  args: {
    session: SESSION,
    photoUrl: (path) => `/media/wake-photos/${path}`,
    onBack: fn(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByTestId("session-event")).toHaveLength(6);
    await expect(canvas.getByText("tile/tap")).toBeInTheDocument();
    await expect(canvas.getByText("tile_climate")).toBeInTheDocument();
  },
};

export const NoPhotos: Story = {
  args: {
    session: { ...SESSION, photoPaths: [] },
    photoUrl: (path) => `/media/wake-photos/${path}`,
    onBack: fn(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByTestId("session-event")).toHaveLength(6);
    await expect(canvas.queryByAltText("Wake burst frame")).toBeNull();
  },
};

export const SingleEvent: Story = {
  args: {
    session: {
      ...SESSION,
      eventCount: 0,
      photoPaths: [SESSION.photoPaths[0]],
      events: [SESSION.events[0]],
      endedAt: null,
      durationMs: null,
      endReason: null,
    },
    photoUrl: (path) => `/media/wake-photos/${path}`,
    onBack: fn(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByTestId("session-event")).toHaveLength(1);
    await expect(canvas.getByText(/live/)).toBeInTheDocument();
  },
};
