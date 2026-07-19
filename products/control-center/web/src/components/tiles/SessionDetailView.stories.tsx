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
  eventCount: 5,
  endReason: "idle-dim",
  deviceName: "wall-panel",
  digest: "Climate · Desk lamp · Settings",
  photoPaths: [
    "2026/07/18/1784487842000-0.jpg",
    "2026/07/18/1784487843300-0.jpg",
    "2026/07/18/1784487844000-0.jpg",
  ],
  events: [
    { ts: T0, idx: 0, msg: "session/start", data: { interactionSessionId: SID } },
    { ts: T0 + 400, idx: 1, msg: "session/wake", data: { target: "panel" } },
    {
      ts: T0 + 4_100,
      idx: 2,
      msg: "tile/tap",
      data: { target: "tile_climate", label: "Climate", kind: "open-modal" },
    },
    { ts: T0 + 4_600, idx: 3, msg: "modal/open", data: { target: "modal.Climate" } },
    {
      ts: T0 + 9_200,
      idx: 4,
      msg: "control/change",
      data: { target: "control.lamp.desk", brightness: 60 },
    },
    {
      ts: T0 + 21_000,
      idx: 5,
      msg: "settings/change",
      data: { target: "settings.idleDimLevel", from: 0.2, to: 0.3 },
    },
    {
      ts: T0 + 134_000,
      idx: 6,
      msg: "session/end",
      data: { reason: "idle-dim", events: 5, durationMs: 134_000 },
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
    await expect(canvas.getAllByTestId("session-event")).toHaveLength(7);
    // The transcript now reads as sentences, not raw surface/action + target.
    await expect(canvas.getByText(/Tapped .*Climate/)).toBeInTheDocument();
    await expect(canvas.getByText("Set Desk lamp → 60%")).toBeInTheDocument();
    await expect(canvas.getByText("Set Idle dim level 0.2 → 0.3")).toBeInTheDocument();
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
    await expect(canvas.getAllByTestId("session-event")).toHaveLength(7);
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
