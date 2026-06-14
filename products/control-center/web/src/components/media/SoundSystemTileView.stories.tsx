/**
 * Stories for SoundSystemTileView.
 * Chosen design (www-xlyf): "Filled group panel , Line-in boxed, lock in its cap".
 * An active multi-room group (playing) is boxed in accent with a group lock; its
 * coordinator is signalled by a blue name (www-a5rl, replacing the old COORD
 * sublabel). A single active room shows no group lock. Idle rooms sit in a plain
 * panel.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";
import { SoundSystemTileView } from "./SoundSystemTileView";

// Desk + Bed are a playing multi-room group (Desk coordinates); the rest are idle.
const rooms = [
  {
    uuid: "desk",
    coordinatorUuid: "desk",
    memberUuids: ["desk", "bed"],
    name: "Desk",
    isCoordinator: true,
    volume: 66,
    muted: false,
    transportState: "PLAYING",
    sourceLabel: "Line-in",
  },
  {
    uuid: "bed",
    coordinatorUuid: "desk",
    memberUuids: ["desk", "bed"],
    name: "Bedroom",
    isCoordinator: false,
    volume: 68,
    muted: false,
    transportState: "PLAYING",
    sourceLabel: "Line-in",
  },
  {
    uuid: "lr",
    coordinatorUuid: "lr",
    memberUuids: ["lr"],
    name: "Living Room",
    isCoordinator: true,
    volume: 70,
    muted: false,
    transportState: "STOPPED",
    sourceLabel: null,
  },
  {
    uuid: "bath",
    coordinatorUuid: "bath",
    memberUuids: ["bath"],
    name: "Bathroom",
    isCoordinator: true,
    volume: 68,
    muted: false,
    transportState: "STOPPED",
    sourceLabel: null,
  },
  {
    uuid: "kit",
    coordinatorUuid: "kit",
    memberUuids: ["kit"],
    name: "Kitchen",
    isCoordinator: true,
    volume: 53,
    muted: false,
    transportState: "STOPPED",
    sourceLabel: null,
  },
];

const meta = {
  title: "Media/SoundSystemTileView",
  component: SoundSystemTileView,
  tags: ["autodocs"],
  decorators: [
    // Real tile footprint: 4×3 board cells ≈ 431×319.
    (Story) => (
      <div style={{ width: 431, height: 319, background: "#000", position: "relative" }}>
        <Story />
      </div>
    ),
  ],
  args: {
    rooms,
    vols: Object.fromEntries(rooms.map((r) => [r.uuid, r.volume])),
    mutes: Object.fromEntries(rooms.map((r) => [r.uuid, r.muted])),
    globalLock: false,
    groupLock: false,
    onFaderChange: fn(),
    onToggleGlobalLock: fn(),
    onToggleGroupLock: fn(),
    onOpenMixer: fn(),
    onOpenSource: fn(),
  },
} satisfies Meta<typeof SoundSystemTileView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  args: { status: "populated" },
  play: async ({ args, canvasElement }) => {
    // Tapping a room name opens the per-room source picker.
    const sourceTrigger = canvasElement.querySelector<HTMLButtonElement>(
      "[aria-label='Living Room source']",
    );
    await expect(sourceTrigger).toBeTruthy();
    sourceTrigger?.click();
    await expect(args.onOpenSource).toHaveBeenCalledWith("lr");
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

export const GroupLocked: Story = {
  args: { status: "populated", groupLock: true },
};

export const GlobalLocked: Story = {
  args: { status: "populated", globalLock: true },
};
