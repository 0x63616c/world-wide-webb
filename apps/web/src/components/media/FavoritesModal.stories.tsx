/**
 * Stories for FavoritesModal (CC-51hf.24).
 * A29: Real cover grid + zone target picker.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";
import { FavoritesModal } from "./FavoritesModal";

const favorites = [
  { title: "Chill Mix", uri: "x-sonosapi:chill", albumArtUri: null },
  { title: "Morning Vibes", uri: "x-sonosapi:morning", albumArtUri: null },
  { title: "Late Night Jazz", uri: "x-sonosapi:jazz", albumArtUri: null },
  { title: "Workout Beats", uri: "x-sonosapi:workout", albumArtUri: null },
];

const zones = ["Living Room", "Desk", "Bedroom", "Kitchen"];

const meta = {
  title: "Media/FavoritesModal",
  component: FavoritesModal,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div style={{ width: 600, height: 700, background: "#111", position: "relative" }}>
        <Story />
      </div>
    ),
  ],
  args: {
    open: true,
    favorites,
    zones,
    onClose: fn(),
    onPlay: fn(),
  },
} satisfies Meta<typeof FavoritesModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  play: async () => {
    const dialog = document.body.querySelector("[role='dialog']");
    await expect(dialog).toBeTruthy();
  },
};
