import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { TimeSuiteBannerView } from "./TimeSuiteBanner";

// Board-like container so the banner renders on its real dark stage (same
// pattern as DeviceNameBanner.stories / AppUpdateBanner.stories).
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
        display: "flex",
        justifyContent: "flex-end",
        alignItems: "flex-start",
        padding: 18,
        boxSizing: "border-box",
      }}
    >
      {children}
    </div>
  );
}

const meta = {
  title: "Components/Banners/Time Suite",
  component: TimeSuiteBannerView,
  tags: ["autodocs"],
  args: {
    tone: "amber",
    message: "Timer done — 10 min",
    onStop: fn(),
    onOpen: fn(),
  },
  decorators: [
    (Story) => (
      <BoardStage>
        <Story />
      </BoardStage>
    ),
  ],
} satisfies Meta<typeof TimeSuiteBannerView>;

export default meta;
type Story = StoryObj<typeof meta>;

// A finished timer nags until stopped; Stop silences without navigating.
// Each story carries its OWN spies: composeStories runs both in one module,
// so meta-level fn()s would leak one story's clicks into the other's asserts.
export const TimerDone: Story = {
  args: { onStop: fn(), onOpen: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/timer done/i)).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Stop" }));
    await expect(args.onStop).toHaveBeenCalled();
    await expect(args.onOpen).not.toHaveBeenCalled();
  },
};

// A firing alarm is the assertive red case; the banner body deep-links to the
// clock detail's Alarm variant.
export const AlarmFiring: Story = {
  args: {
    tone: "red",
    message: "Alarm — 7:30 AM",
    role: "alert",
    ariaLive: "assertive",
    onStop: fn(),
    onOpen: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const banner = canvas.getByRole("alert");
    await expect(banner).toHaveTextContent("Alarm — 7:30 AM");
    await userEvent.click(banner);
    await expect(args.onOpen).toHaveBeenCalled();
    await expect(args.onStop).not.toHaveBeenCalled();
  },
};
