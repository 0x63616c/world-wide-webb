import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { defineTileMeta } from "./__stories__/factory";
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
  ...defineTileMeta("Next12HoursView", Next12HoursViewStory),
  parameters: {
    layout: "centered",
    // Suppress the global BoardDecorator; the story decorator applies its own e-root wrapper
    // with fixed slot dimensions so Storybook renders the tile at its intended wall-panel size.
    boardWrapper: false,
  },
  // Apply the board dark-mode CSS classes so the tile renders against the correct dark surface,
  // and constrain to the wall-panel slot dimensions (460×260).
  decorators: [
    (Story) => (
      <div
        className="e-root"
        style={{ background: "var(--bg)", width: 460, height: 260, overflow: "hidden" }}
      >
        <Story />
      </div>
    ),
  ],
  argTypes: {
    status: {
      control: { type: "select" },
      options: ["loading", "populated"],
      description: "Toggle between skeleton loading state and fully-populated chart.",
    },
    hours: {
      control: "object",
      description: "Array of HourlyEntry objects (only used when status is 'populated').",
    },
  },
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

    // One SVG bar per hour entry.
    const rects = canvasElement.querySelectorAll("svg rect");
    await expect(rects.length).toBe(12);

    // Feels-like polyline present and kept subtle (opacity < 1).
    const polyline = canvasElement.querySelector("polyline");
    await expect(polyline).not.toBeNull();
    await expect(Number(polyline?.getAttribute("opacity") ?? "1")).toBeLessThan(1);

    // Bar heights are proportional to temp values.
    // Chart math (initial size fallback: h=0 → chartH = max(120, (0||200)-44) = 156):
    //   gMin=62, gMax=79, range=17, span=chartH-topRes-minBar=156-22-14=120
    //   barH(v) = 14 + ((v-62)/17)*120
    const chartH = 156;
    const topRes = 22;
    const minBar = 14;
    const gMin = 62;
    const gMax = 79;
    const span = chartH - topRes - minBar;
    const barH = (v: number) => minBar + ((v - gMin) / (gMax - gMin)) * span;
    const temps = [74, 76, 78, 79, 77, 73, 70, 68, 66, 65, 64, 63];
    for (let i = 0; i < temps.length; i++) {
      const expectedH = barH(temps[i]);
      const actualH = Number(rects[i].getAttribute("height"));
      await expect(Math.abs(actualH - expectedH)).toBeLessThan(1);
      const expectedY = chartH - expectedH;
      const actualY = Number(rects[i].getAttribute("y"));
      await expect(Math.abs(actualY - expectedY)).toBeLessThan(1);
    }

    // Polyline points match feels values scaled to chart coordinates.
    const n = 12;
    const renderW = 400; // CHART_INITIAL_WIDTH fallback
    const colW = renderW / n;
    const cx = (i: number) => (i + 0.5) * colW;
    const feels = [73, 75, 77, 78, 76, 72, 69, 67, 65, 64, 63, 62];
    const points = polyline?.getAttribute("points") ?? "";
    const pairs = points.trim().split(/\s+/);
    await expect(pairs.length).toBe(n);
    for (let i = 0; i < n; i++) {
      const [px, py] = pairs[i].split(",").map(Number);
      await expect(Math.abs(px - cx(i))).toBeLessThan(1);
      await expect(Math.abs(py - (chartH - barH(feels[i])))).toBeLessThan(1);
    }

    // Icon SVGs present — 1 chart + 1 header + 12 hour icons = 14 total.
    await expect(canvasElement.querySelectorAll("svg").length).toBe(14);

    // Icon row does not overflow the 260px container (top = 4 + chartH + 6 = 166 < 260).
    const iconRow = canvasElement.querySelector<HTMLElement>(
      '[style*="position: absolute"][style*="display: flex"]',
    );
    await expect(iconRow).not.toBeNull();
    await expect(Number.parseFloat(iconRow?.style.top ?? "999")).toBeLessThan(260);
  },
};

// Single-hour edge case: feels < temp so range > 0; bar must have valid positive dimensions.
export const SingleHour: Story = {
  args: { status: "populated", hours: SINGLE_HOUR },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Next 12 Hours")).toBeInTheDocument();
    const rects = canvasElement.querySelectorAll("svg rect");
    await expect(rects.length).toBe(1);
    // Dimensions must be finite positive — no NaN from degenerate ranges.
    const rect = rects[0];
    await expect(Number(rect?.getAttribute("width"))).toBeGreaterThan(0);
    await expect(Number(rect?.getAttribute("height"))).toBeGreaterThan(0);
    // Calculated: gMin=70(feels), gMax=72(temp), range=2; barH(72)=14+((72-70)/2)*120=134
    await expect(Math.abs(Number(rect?.getAttribute("height")) - 134)).toBeLessThan(1);
    // 1 chart + 1 header + 1 hour icon = 3 SVGs total.
    await expect(canvasElement.querySelectorAll("svg").length).toBe(3);
  },
};

// Short series exercises all four icon types.
export const IconVariety: Story = {
  args: { status: "populated", hours: ICON_VARIETY_HOURS },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Next 12 Hours")).toBeInTheDocument();
    await expect(canvasElement.querySelectorAll("svg rect").length).toBe(4);
    // 1 chart + 1 header + 4 hour icons = 6 SVGs — confirms all icon variants render.
    await expect(canvasElement.querySelectorAll("svg").length).toBe(6);
  },
};
