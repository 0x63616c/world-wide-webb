/**
 * Stories for AllAppsModal (CC-51hf.22).
 * A27: Searchable full-color grid of Apple TV apps.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";
import { AllAppsModal } from "./AllAppsModal";

const apps = [
  "Netflix",
  "Disney+",
  "Hulu",
  "Apple TV+",
  "YouTube",
  "Spotify",
  "Prime Video",
  "HBO Max",
  "Peacock",
  "Paramount+",
];

const meta = {
  title: "Media/AllAppsModal",
  component: AllAppsModal,
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
    apps,
    currentApp: "Netflix",
    onClose: fn(),
    onLaunchApp: fn(),
  },
} satisfies Meta<typeof AllAppsModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  play: async () => {
    const dialog = document.body.querySelector("[role='dialog']");
    await expect(dialog).toBeTruthy();
  },
};

export const Closed: Story = {
  args: { open: false },
  play: async () => {
    const dialog = document.body.querySelector("[role='dialog']");
    await expect(dialog).toBeFalsy();
  },
};

/** The full live prod source_list (CC-rii3) — every app must show a brand mark. */
export const FullProdList: Story = {
  args: {
    apps: [
      "AMC+",
      "App Store",
      "Arcade",
      "BBC iPlayer",
      "CNN",
      "Computers",
      "Disney+",
      "FaceTime",
      "Fitness",
      "HBO Max",
      "Hulu",
      "Music",
      "Netflix",
      "Paramount+",
      "Peacock",
      "Photos",
      "Podcasts",
      "Prime Video",
      "Search",
      "Settings",
      "Sling",
      "Spotify",
      "TV",
      "Twitch",
      "VLC",
      "Watch TruBlu",
      "YouTube",
    ],
    currentApp: "YouTube",
  },
  play: async () => {
    const dialog = document.body.querySelector("[role='dialog']");
    await expect(dialog).toBeTruthy();
  },
};
