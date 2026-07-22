import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { ClimateHouseSummaryHeader } from "./ClimateHouseSummaryHeader";

// Fixed-size wrapper so the banner has a sensible canvas width in Storybook.
function BannerBox({ children }: { children: React.ReactNode }) {
  return <div style={{ width: 640, padding: 16 }}>{children}</div>;
}

const meta = {
  title: "Components/ClimateHouseSummaryHeader",
  component: ClimateHouseSummaryHeader,
  tags: ["autodocs"],
  args: {
    avgAmbientF: 72.4,
    anyActive: false,
    secondLabel: "Status",
    secondValue: "Idle",
  },
  decorators: [
    (Story) => (
      <BannerBox>
        <Story />
      </BannerBox>
    ),
  ],
} satisfies Meta<typeof ClimateHouseSummaryHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

// ─── states ───────────────────────────────────────────────────────────────────

/** No zone is heating or cooling , neutral state. */
export const Idle: Story = {
  args: {
    avgAmbientF: 72.4,
    anyActive: false,
    secondLabel: "Status",
    secondValue: "Idle",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("72°F")).toBeInTheDocument();
    await expect(canvas.getByText("Status")).toBeInTheDocument();
  },
};

/** At least one zone is actively conditioning , accent color active. */
export const Active: Story = {
  args: {
    avgAmbientF: 68.8,
    anyActive: true,
    secondLabel: "Status",
    secondValue: "Cooling",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("69°F")).toBeInTheDocument();
    await expect(canvas.getByText("Status")).toBeInTheDocument();
  },
};

/** Second column label reads "Schedule" (used by ClimateModalScheduleTimeline). */
export const ScheduleLabel: Story = {
  args: {
    avgAmbientF: 74.0,
    anyActive: false,
    secondLabel: "Schedule",
    secondValue: "Home 72°",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("74°F")).toBeInTheDocument();
    await expect(canvas.getByText("Schedule")).toBeInTheDocument();
  },
};

/** Optional right slot , e.g. a caret legend pill as used by the Schedule modal. */
export const WithRightSlot: Story = {
  args: {
    avgAmbientF: 71.5,
    anyActive: false,
    secondLabel: "Status",
    secondValue: "Idle",
    right: (
      <span className="pill" style={{ fontSize: 11 }} data-testid="right-slot">
        Now · 14:00
      </span>
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("72°F")).toBeInTheDocument();
    await expect(canvas.getByTestId("right-slot")).toBeInTheDocument();
    await expect(canvas.getByText("Now · 14:00")).toBeInTheDocument();
  },
};
