/**
 * Stories for SourceModal (CC-51hf.20).
 * A25: Per-room source chips (Line-in/TV/Spotify/AirPlay/Idle).
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";
import { SourceModal } from "./SourceModal";

const rooms = [
  {
    coordinatorUuid: "lr",
    uuid: "lr",
    deviceIp: "192.168.0.1",
    memberUuids: ["lr", "lr-rf"],
    name: "Living Room",
    isCoordinator: true,
    volume: 45,
    muted: false,
    transportState: "PLAYING",
    sourceLabel: null,
  },
  {
    coordinatorUuid: "desk",
    uuid: "desk",
    deviceIp: "192.168.0.2",
    memberUuids: ["desk"],
    name: "Desk",
    isCoordinator: true,
    volume: 30,
    muted: false,
    transportState: "STOPPED",
    sourceLabel: null,
  },
];

const meta = {
  title: "Media/SourceModal",
  component: SourceModal,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div style={{ width: 600, height: 600, background: "#111", position: "relative" }}>
        <Story />
      </div>
    ),
  ],
  args: {
    open: true,
    rooms,
    onClose: fn(),
    onSetSource: fn(),
  },
} satisfies Meta<typeof SourceModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  play: async ({ canvasElement }) => {
    const dialog = document.body.querySelector("[role='dialog']");
    await expect(dialog).toBeTruthy();
  },
};
