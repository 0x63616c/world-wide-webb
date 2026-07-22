import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { AppUpdateBannerView } from "./AppUpdateBanner";

// Board-like container so the absolute positioning renders correctly (same
// stage as ConnectionLostBanner.stories).
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
  title: "Components/Banners/App Update",
  component: AppUpdateBannerView,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <BoardStage>
        <Story />
      </BoardStage>
    ),
  ],
} satisfies Meta<typeof AppUpdateBannerView>;

export default meta;
type Story = StoryObj<typeof meta>;

// The common case: a few TestFlight builds ahead of the panel.
export const BuildsBehind: Story = {
  args: {
    model: {
      buildNumber: 68,
      message: "Update available",
      detail: "1.0 (68) · 3 builds behind · 2 days old",
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("status")).toBeInTheDocument();
    await expect(canvas.getByText(/update available/i)).toBeInTheDocument();
    await expect(canvas.getByText(/3 builds behind/i)).toBeInTheDocument();
  },
};

// Exactly one build behind , singular copy.
export const OneBuildBehind: Story = {
  args: {
    model: {
      buildNumber: 69,
      message: "Update available",
      detail: "1.0 (69) · 1 build behind · 4hrs old",
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/1 build behind/i)).toBeInTheDocument();
  },
};

// No dismiss affordance: banner has no button, stays until build catches up.
export const NoDismissButton: Story = {
  args: {
    model: {
      buildNumber: 68,
      message: "Update available",
      detail: "1.0 (68) · 3 builds behind · 2 days old",
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("button")).not.toBeInTheDocument();
  },
};
