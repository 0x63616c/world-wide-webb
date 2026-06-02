import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { defineTileMeta } from "./__stories__/factory";
import type { HourlyEntry } from "./Next12HoursView";
import { Next12HoursView } from "./Next12HoursView";

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

// Single entry — feels < temp so range is non-zero; confirms NaN guard on barW/barH division.
const SINGLE_HOUR: HourlyEntry[] = [{ t: "Now", temp: 72, feels: 70, ic: "sun" }];

// All four supported icon names in compact form.
const ICON_VARIETY_HOURS: HourlyEntry[] = [
  { t: "1AM", temp: 60, feels: 59, ic: "moon" },
  { t: "2AM", temp: 61, feels: 60, ic: "cloud" },
  { t: "3AM", temp: 62, feels: 61, ic: "cloud-sun" },
  { t: "4AM", temp: 63, feels: 62, ic: "sun" },
];

const meta = {
  ...defineTileMeta("Next12HoursView", Next12HoursView),
  // Sizing comes from the global BoardDecorator via the tile registry (4×2 → 426×312),
  // the same path every other tile story uses. No hand-coded slot size to drift.
  argTypes: {
    hours: {
      control: "object",
      description: "Array of HourlyEntry objects (only used when status is 'populated').",
    },
  },
} satisfies Meta<typeof Next12HoursView>;

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
    // No SVG chart or icon elements while loading.
    await expect(canvasElement.querySelector("polyline")).toBeNull();
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

    // One bar per hour entry (flex-column <div data-bar>, not an SVG rect).
    const bars = canvasElement.querySelectorAll<HTMLElement>("[data-bar]");
    await expect(bars.length).toBe(12);
    // Each bar has a positive px height from the value→height scale.
    for (const bar of bars) {
      await expect(Number.parseFloat(bar.style.height)).toBeGreaterThan(0);
    }

    // Feels-like polyline present, with one point per hour, kept subtle (opacity < 1).
    const polyline = canvasElement.querySelector("polyline");
    await expect(polyline).not.toBeNull();
    await expect(Number(polyline?.getAttribute("opacity") ?? "1")).toBeLessThan(1);
    const pairs = (polyline?.getAttribute("points") ?? "").trim().split(/\s+/);
    await expect(pairs.length).toBe(12);

    // 1 feels-overlay SVG + 1 header Icon SVG + 12 hour Icon SVGs = 14 total.
    await expect(canvasElement.querySelectorAll("svg").length).toBe(14);
  },
};

// Single-hour edge case: feels < temp so range > 0; bar must have valid positive dimensions.
export const SingleHour: Story = {
  args: { status: "populated", hours: SINGLE_HOUR },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Next 12 Hours")).toBeInTheDocument();
    const bars = canvasElement.querySelectorAll<HTMLElement>("[data-bar]");
    await expect(bars.length).toBe(1);
    // Height must be finite positive — no NaN from a degenerate range.
    const h = Number.parseFloat(bars[0].style.height);
    await expect(Number.isFinite(h) && h > 0).toBe(true);
    // 1 feels-overlay + 1 header + 1 hour icon = 3 SVGs total.
    await expect(canvasElement.querySelectorAll("svg").length).toBe(3);
  },
};

// Short series exercises all four icon types.
export const IconVariety: Story = {
  args: { status: "populated", hours: ICON_VARIETY_HOURS },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Next 12 Hours")).toBeInTheDocument();
    await expect(canvasElement.querySelectorAll("[data-bar]").length).toBe(4);
    // 1 feels-overlay + 1 header + 4 hour icons = 6 SVGs — confirms all icon variants render.
    await expect(canvasElement.querySelectorAll("svg").length).toBe(6);
  },
};
