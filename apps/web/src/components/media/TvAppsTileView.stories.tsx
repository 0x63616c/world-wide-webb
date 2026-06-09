/**
 * Stories for TvAppsTileView (CC-0z4f).
 * Hero card with brand logo + status pill + 2×2 brand-logo grid.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";
import { TvAppsTileView } from "./TvAppsTileView";

// Mix of registered brand marks + apps that fall back to the monospace glyph.
const apps = [
  "YouTube",
  "Netflix",
  "Prime Video",
  "Disney+",
  "Hulu",
  "Apple TV+",
  "AMC+",
  "App Store",
];

const meta = {
  title: "Media/TvAppsTileView",
  component: TvAppsTileView,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div style={{ width: 431, height: 207, background: "#000", position: "relative" }}>
        <Story />
      </div>
    ),
  ],
  args: {
    apps,
    onLaunchApp: fn(),
    onOpenAllApps: fn(),
  },
} satisfies Meta<typeof TvAppsTileView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const YouTubeOpen: Story = {
  args: { status: "populated", currentApp: "YouTube" },
  play: async ({ canvasElement }) => {
    const hero = canvasElement.querySelector('[aria-label="YouTube — open"]');
    await expect(hero).toBeTruthy();
  },
};

export const NetflixOpen: Story = {
  args: { status: "populated", currentApp: "Netflix" },
  play: async ({ canvasElement }) => {
    const hero = canvasElement.querySelector('[aria-label="Netflix — open"]');
    await expect(hero).toBeTruthy();
  },
};

export const Idle: Story = {
  args: { status: "populated", currentApp: null },
  play: async ({ canvasElement }) => {
    const hero = canvasElement.querySelector('[aria-label="Nothing open"]');
    await expect(hero).toBeTruthy();
  },
};

export const Loading: Story = {
  args: { status: "loading", currentApp: null },
};
