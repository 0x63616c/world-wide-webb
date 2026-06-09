/**
 * Stories for MixerModal (www-51hf.19).
 * A24: Full-height grouped faders, global-link header, per-room mute.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";
import type { MixerState } from "./hooks/useMixer";
import { MixerModal } from "./MixerModal";

const rooms = [
  {
    coordinatorUuid: "lr",
    memberUuids: ["lr"],
    name: "Living Room",
    isCoordinator: true,
    volume: 45,
    muted: false,
    transportState: "PLAYING",
    sourceLabel: null,
  },
  {
    coordinatorUuid: "desk",
    memberUuids: ["desk"],
    name: "Desk",
    isCoordinator: true,
    volume: 30,
    muted: false,
    transportState: "STOPPED",
    sourceLabel: null,
  },
  {
    coordinatorUuid: "bed",
    memberUuids: ["bed"],
    name: "Bedroom",
    isCoordinator: true,
    volume: 20,
    muted: true,
    transportState: "STOPPED",
    sourceLabel: null,
  },
];

const mixer: MixerState = {
  vols: { lr: 45, desk: 30, bed: 20 },
  mutes: { lr: false, desk: false, bed: true },
  member: {},
  globalLock: false,
  groupLock: false,
  setRoomVolume: fn(),
  join: fn(),
  leave: fn(),
  toggleGroupLock: fn(),
  setGlobalLock: fn(),
  toggleMute: fn(),
};

const meta = {
  title: "Media/MixerModal",
  component: MixerModal,
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
    mixer,
    onClose: fn(),
    onSetVolume: fn(),
    onSetMute: fn(),
    onGroupJoin: fn(),
    onGroupLeave: fn(),
  },
} satisfies Meta<typeof MixerModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  play: async ({ canvasElement }) => {
    const dialog = canvasElement.querySelector("[role='dialog']");
    await expect(dialog).toBeTruthy();
  },
};

export const GlobalLocked: Story = {
  args: {
    mixer: { ...mixer, globalLock: true },
  },
};
