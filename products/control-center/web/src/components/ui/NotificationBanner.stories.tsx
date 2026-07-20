import type { Meta, StoryObj } from "@storybook/react-vite";
import { NotificationBanner, NotificationBannerStack } from "./NotificationBanner";

const meta = {
  title: "UI/NotificationBanner",
  component: NotificationBanner,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div
        style={{
          position: "relative",
          width: 420,
          height: 220,
          background: "var(--bg, #0b0b0c)",
          borderRadius: 12,
        }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NotificationBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Red: Story = {
  args: {
    tone: "red",
    role: "alert",
    ariaLive: "assertive",
    children: "Please set your device name in settings",
  },
};

export const Amber: Story = {
  args: { tone: "amber", children: "Unable to connect…" },
};

export const Green: Story = {
  args: { tone: "green", children: "Update available · 3 builds behind" },
};

// The real board layout: several banners flow top-down in the corner stack and
// pack tight with no gaps, whichever subset is live.
export const Stacked: Story = {
  args: { tone: "amber", children: "" },
  render: () => (
    <NotificationBannerStack>
      <NotificationBanner tone="red" role="alert" ariaLive="assertive">
        Please set your device name in settings
      </NotificationBanner>
      <NotificationBanner tone="amber">Unable to connect…</NotificationBanner>
      <NotificationBanner tone="green">Update available · 3 builds behind</NotificationBanner>
    </NotificationBannerStack>
  ),
};
