import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import type { HourlyEntry } from "./Next12HoursView";
import { Next12HoursView } from "./Next12HoursView";

// Flat args shape that avoids Storybook's inability to spread a discriminated union.
// The wrapper maps status + hours back into the correct union variant before rendering.
type StoryArgs = {
  status: "loading" | "populated";
  hours?: HourlyEntry[];
};

function Next12HoursViewStory({ status, hours }: StoryArgs) {
  if (status === "populated" && hours) {
    return <Next12HoursView status="populated" hours={hours} />;
  }
  return <Next12HoursView status="loading" />;
}

// Realistic 12-hour forecast anchored to the current hour — same shape the API returns.
const SAMPLE_HOURS: HourlyEntry[] = [
  { t: "Now", temp: 74, feels: 73, ic: "cloud-sun" },
  { t: "2PM", temp: 76, feels: 75, ic: "sun" },
  { t: "3PM", temp: 78, feels: 77, ic: "sun" },
  { t: "4PM", temp: 79, feels: 78, ic: "sun" },
  { t: "5PM", temp: 77, feels: 76, ic: "cloud-sun" },
  { t: "6PM", temp: 73, feels: 72, ic: "cloud" },
  { t: "7PM", temp: 70, feels: 69, ic: "cloud" },
  { t: "8PM", temp: 68, feels: 67, ic: "moon" },
  { t: "9PM", temp: 66, feels: 65, ic: "moon" },
  { t: "10PM", temp: 65, feels: 64, ic: "moon" },
  { t: "11PM", temp: 64, feels: 63, ic: "moon" },
  { t: "12AM", temp: 63, feels: 62, ic: "moon" },
];

// Single entry exercises the edge-case where gMin === gMax (degenerate range).
const SINGLE_HOUR: HourlyEntry[] = [{ t: "Now", temp: 72, feels: 70, ic: "sun" }];

// All four supported icon names in compact form.
const ICON_VARIETY_HOURS: HourlyEntry[] = [
  { t: "1AM", temp: 60, feels: 59, ic: "moon" },
  { t: "2AM", temp: 61, feels: 60, ic: "cloud" },
  { t: "3AM", temp: 62, feels: 61, ic: "cloud-sun" },
  { t: "4AM", temp: 63, feels: 62, ic: "sun" },
];

const meta = {
  title: "Tiles/Next12HoursView",
  component: Next12HoursViewStory,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
  // Fixed-size container matching the wall-panel slot so the tile renders at its intended size.
  decorators: [
    (Story) => (
      <div style={{ width: 460, height: 260 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Next12HoursViewStory>;

export default meta;
type Story = StoryObj<typeof meta>;

// Skeleton shimmer renders while weather data is in-flight from the API.
export const Loading: Story = {
  args: { status: "loading" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Section header absent — no data yet.
    await expect(canvas.queryByText("Next 12 Hours")).toBeNull();
    // Tile container present so the slot retains its shape.
    await expect(canvasElement.querySelector(".tile")).not.toBeNull();
  },
};

// Fully-populated state with all 12 hours and every icon type represented.
export const Populated: Story = {
  args: { status: "populated", hours: SAMPLE_HOURS },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Next 12 Hours")).toBeInTheDocument();
    // Legend items confirm both series are labelled.
    await expect(canvas.getByText("┈ Feels")).toBeInTheDocument();
    await expect(canvas.getByText("▮ Temp")).toBeInTheDocument();
    // First hour label.
    await expect(canvas.getAllByText("Now").length).toBeGreaterThan(0);
    // One SVG bar per hour entry.
    const rects = canvasElement.querySelectorAll("svg rect");
    await expect(rects.length).toBe(12);
    // Feels-like polyline present and kept subtle (opacity < 1).
    const polyline = canvasElement.querySelector("polyline");
    await expect(polyline).not.toBeNull();
    await expect(Number(polyline?.getAttribute("opacity") ?? "1")).toBeLessThan(1);
  },
};

// Single-hour edge case: degenerate range (gMin === gMax) must not produce NaN dimensions.
export const SingleHour: Story = {
  args: { status: "populated", hours: SINGLE_HOUR },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Next 12 Hours")).toBeInTheDocument();
    const rects = canvasElement.querySelectorAll("svg rect");
    await expect(rects.length).toBe(1);
    // NaN guard: bar must have finite positive dimensions.
    const rect = rects[0];
    await expect(Number(rect?.getAttribute("width"))).toBeGreaterThan(0);
    await expect(Number(rect?.getAttribute("height"))).toBeGreaterThan(0);
  },
};

// Short series exercises all four icon types.
export const IconVariety: Story = {
  args: { status: "populated", hours: ICON_VARIETY_HOURS },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Next 12 Hours")).toBeInTheDocument();
    await expect(canvasElement.querySelectorAll("svg rect").length).toBe(4);
  },
};
