/**
 * Stories for SoundSystemTileView (www-51hf.18).
 * A22: Sound System 4×3 tile with grouped vertical faders.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";
import { SoundSystemTileView } from "./SoundSystemTileView";

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
  {
    coordinatorUuid: "bath",
    memberUuids: ["bath"],
    name: "Bathroom",
    isCoordinator: true,
    volume: 15,
    muted: false,
    transportState: "STOPPED",
    sourceLabel: null,
  },
  {
    coordinatorUuid: "kit",
    memberUuids: ["kit"],
    name: "Kitchen",
    isCoordinator: true,
    volume: 35,
    muted: false,
    transportState: "PAUSED_PLAYBACK",
    sourceLabel: null,
  },
];

const meta = {
  title: "Media/SoundSystemTileView",
  component: SoundSystemTileView,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div style={{ width: 280, height: 220, background: "#111", position: "relative" }}>
        <Story />
      </div>
    ),
  ],
  args: {
    rooms,
    vols: Object.fromEntries(rooms.map((r) => [r.coordinatorUuid, r.volume])),
    mutes: Object.fromEntries(rooms.map((r) => [r.coordinatorUuid, r.muted])),
    globalLock: false,
    onFaderChange: fn(),
    onToggleGlobalLock: fn(),
    onOpenMixer: fn(),
  },
} satisfies Meta<typeof SoundSystemTileView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  args: { status: "populated" },
  play: async ({ canvasElement }) => {
    const header =
      canvasElement.querySelector("[class*='header']") ?? canvasElement.querySelector("span");
    await expect(header).toBeTruthy();
  },
};

export const Loading: Story = {
  args: { status: "loading" },
  play: async ({ canvasElement }) => {
    const skeleton =
      canvasElement.querySelector("[data-skeleton]") ?? canvasElement.querySelector("[aria-busy]");
    await expect(skeleton).toBeTruthy();
  },
};

export const GlobalLocked: Story = {
  args: { status: "populated", globalLock: true },
};
