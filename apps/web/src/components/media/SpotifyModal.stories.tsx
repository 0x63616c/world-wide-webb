/**
 * Stories for SpotifyModal (www-51hf.25).
 * A30: Real Spotify content — recently played + made for you rows.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";
import { SpotifyModal } from "./SpotifyModal";

const recentlyPlayed = [
  {
    id: "t1",
    title: "Blinding Lights",
    artist: "The Weeknd",
    albumArtUrl: null,
    uri: "spotify:track:t1",
  },
  { id: "t2", title: "Levitating", artist: "Dua Lipa", albumArtUrl: null, uri: "spotify:track:t2" },
  { id: "t3", title: "Stay", artist: "Kid Laroi", albumArtUrl: null, uri: "spotify:track:t3" },
];

const playlists = [
  { id: "p1", title: "Daily Mix 1", description: null, imageUrl: null, uri: "spotify:playlist:p1" },
  {
    id: "p2",
    title: "Discover Weekly",
    description: null,
    imageUrl: null,
    uri: "spotify:playlist:p2",
  },
  {
    id: "p3",
    title: "Release Radar",
    description: null,
    imageUrl: null,
    uri: "spotify:playlist:p3",
  },
];

const zones = ["Living Room", "Desk", "Bedroom"];

const meta = {
  title: "Media/SpotifyModal",
  component: SpotifyModal,
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
    recentlyPlayed,
    playlists,
    zones,
    onClose: fn(),
    onPlay: fn(),
  },
} satisfies Meta<typeof SpotifyModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  play: async () => {
    const dialog = document.body.querySelector("[role='dialog']");
    await expect(dialog).toBeTruthy();
  },
};
