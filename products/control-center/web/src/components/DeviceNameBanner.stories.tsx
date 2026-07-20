import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { DeviceNameBannerView } from "./DeviceNameBanner";

// Board-like container so the absolute positioning renders correctly (same stage
// as ConnectionLostBanner.stories / AppUpdateBanner.stories).
function BoardStage({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "relative",
        width: 1366,
        height: 200,
        background: "#0c0e11",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}

const meta = {
  title: "Components/Banners/Device Name",
  component: DeviceNameBannerView,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <BoardStage>
        <Story />
      </BoardStage>
    ),
  ],
} satisfies Meta<typeof DeviceNameBannerView>;

export default meta;
type Story = StoryObj<typeof meta>;

// The only state: shown, red, top-right, until the user sets a name.
export const Unset: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("alert")).toBeInTheDocument();
    await expect(canvas.getByText(/set your device name/i)).toBeInTheDocument();
  },
};

// No dismiss affordance: the banner carries no button, it only disappears once
// the name is set (which unmounts the whole view).
export const NoDismissButton: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("button")).not.toBeInTheDocument();
  },
};
