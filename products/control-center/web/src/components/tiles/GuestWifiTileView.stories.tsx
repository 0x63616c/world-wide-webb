/**
 * Design-round stories for the Guest Wi-Fi tile face (2x2, sits above the
 * Clock). Three candidate treatments rendered at true production size , the
 * tile is not in the registry yet, so a local decorator applies the 2x2
 * footprint the BoardDecorator would otherwise derive.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { tilePixelSize } from "../../lib/grid-constants";
import { defineTileMeta } from "./__stories__/factory";
import { GuestWifiTileView } from "./GuestWifiTileView";

const { width, height } = tilePixelSize(2, 2);

const meta = {
  ...defineTileMeta("GuestWifiTileView", GuestWifiTileView),
  parameters: { boardWrapper: false },
  decorators: [
    (Story) => (
      <div className="e-root" style={{ width, height, display: "flex", flexDirection: "column" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof GuestWifiTileView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Badge: Story = {
  args: { status: "populated", variant: "badge" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("tap for QR")).toBeInTheDocument();
  },
};

export const MiniQr: Story = {
  args: { status: "populated", variant: "mini-qr" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("scan to join")).toBeInTheDocument();
  },
};

export const Beacon: Story = {
  args: { status: "populated", variant: "beacon" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("guest access")).toBeInTheDocument();
  },
};

export const Loading: Story = {
  args: { status: "loading" },
};
