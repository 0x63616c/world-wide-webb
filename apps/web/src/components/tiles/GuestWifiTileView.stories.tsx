import { GuestWifiTileView } from "@features/guest-wifi/web";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { defineTileMeta } from "./__stories__/factory";

const meta = {
  ...defineTileMeta("GuestWifiTileView", GuestWifiTileView),
} satisfies Meta<typeof GuestWifiTileView>;

export default meta;
type Story = StoryObj<typeof meta>;

// The tap surface belongs to the board (detail registry action → QR modal), so
// the face carries no handler to exercise here.
export const Populated: Story = {
  args: { status: "populated" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Guest")).toBeInTheDocument();
    await expect(canvas.getByText("tap to share")).toBeInTheDocument();
  },
};

export const Loading: Story = {
  args: { status: "loading" },
};
