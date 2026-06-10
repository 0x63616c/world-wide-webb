/**
 * Stories for QuickPlayTileView (CC-51hf.23).
 * A28: Horizontal artwork rail from Sonos Favorites + Spotify.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";
import { QuickPlayTileView } from "./QuickPlayTileView";

const items = [
  { id: "fav-1", title: "Chill Mix", albumArtUri: null, source: "sonos" as const },
  { id: "fav-2", title: "Morning Vibes", albumArtUri: null, source: "sonos" as const },
  { id: "fav-3", title: "Late Night", albumArtUri: null, source: "sonos" as const },
  { id: "spo-1", title: "Daily Mix 1", albumArtUri: null, source: "spotify" as const },
  { id: "spo-2", title: "Discover Weekly", albumArtUri: null, source: "spotify" as const },
];

const meta = {
  title: "Media/QuickPlayTileView",
  component: QuickPlayTileView,
  tags: ["autodocs"],
  args: {
    items,
    playingItemId: "fav-1",
    onPlayItem: fn(),
    onOpenFavorites: fn(),
    onOpenSpotify: fn(),
  },
} satisfies Meta<typeof QuickPlayTileView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  args: { status: "populated" },
  play: async ({ canvasElement }) => {
    const playing = canvasElement.querySelector("[data-playing]");
    await expect(playing).toBeTruthy();
  },
};

export const Loading: Story = {
  args: { status: "loading", playingItemId: null },
};

export const Empty: Story = {
  args: { status: "populated", items: [], playingItemId: null },
};
