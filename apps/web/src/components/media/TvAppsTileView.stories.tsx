/**
 * Stories for TvAppsTileView (www-51hf.21).
 * A26: Hero cell for current app + 2×2 grid of other apps.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";
import { TvAppsTileView } from "./TvAppsTileView";

const apps = ["Netflix", "Disney+", "Hulu", "Apple TV+", "YouTube", "Spotify", "Prime Video"];

const meta = {
  title: "Media/TvAppsTileView",
  component: TvAppsTileView,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div style={{ width: 280, height: 160, background: "#111", position: "relative" }}>
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

export const WithCurrentApp: Story = {
  args: { status: "populated", currentApp: "Netflix" },
  play: async ({ canvasElement }) => {
    const header = canvasElement.querySelector("span");
    await expect(header).toBeTruthy();
  },
};

export const Idle: Story = {
  args: { status: "populated", currentApp: null },
  play: async ({ canvasElement }) => {
    const idle = canvasElement.querySelector("span");
    await expect(idle).toBeTruthy();
  },
};

export const Loading: Story = {
  args: { status: "loading", currentApp: null },
};
