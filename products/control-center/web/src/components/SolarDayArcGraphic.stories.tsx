import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { type ArcDims, SolarDayArcGraphic } from "./SolarDayArcGraphic";

// ─── dim presets (mirror the real callers) ───────────────────────────────────

/** Wide-and-shallow preset (680×200) , the retired clock solar page's geometry,
 *  kept as a second dims fixture exercising the `dims` prop. */
const CLOCK_DIMS: ArcDims = {
  svgW: 680,
  svgH: 200,
  padX: 40,
  midY: 168,
  peakOffset: 148,
};

/** Matches WEATHER_ARC_DIMS in WeatherModalSunDayArc */
const WEATHER_DIMS: ArcDims = {
  svgW: 600,
  svgH: 220,
  padX: 36,
  midY: 184,
  peakOffset: 160,
};

// ─── shared reference times ───────────────────────────────────────────────────

const SUNRISE_ISO = "2026-05-31T06:02:00";
const SUNSET_ISO = "2026-05-31T19:48:00";

// Each story's nowMs is a fixed snapshot so stories are deterministic.
// Daytime: 2026-05-31 T13:00 local , well into the day.
const DAYTIME_NOW = new Date("2026-05-31T13:00:00").getTime();
// Near sunrise: 2026-05-31 T06:10 local , 8 min after sunrise.
const SUNRISE_NOW = new Date("2026-05-31T06:10:00").getTime();
// Near sunset: 2026-05-31 T19:40 local , 8 min before sunset.
const SUNSET_NOW = new Date("2026-05-31T19:40:00").getTime();
// Night: 2026-05-31 T23:00 local , well after sunset.
const NIGHT_NOW = new Date("2026-05-31T23:00:00").getTime();

// ─── wrapper so the SVG has fixed dimensions in Storybook canvas ─────────────

function ArcBox({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "inline-block" }}>{children}</div>;
}

const meta = {
  title: "Components/SolarDayArcGraphic",
  component: SolarDayArcGraphic,
  tags: ["autodocs"],
  args: {
    sunriseIso: SUNRISE_ISO,
    sunsetIso: SUNSET_ISO,
    nowMs: DAYTIME_NOW,
    idPrefix: "story-default",
    dims: CLOCK_DIMS,
  },
  decorators: [
    (Story) => (
      <ArcBox>
        <Story />
      </ArcBox>
    ),
  ],
} satisfies Meta<typeof SolarDayArcGraphic>;

export default meta;
type Story = StoryObj<typeof meta>;

// ─── states ───────────────────────────────────────────────────────────────────

/** Sun well above the horizon (midday). */
export const Daytime: Story = {
  args: {
    idPrefix: "story-daytime",
    nowMs: DAYTIME_NOW,
    dims: CLOCK_DIMS,
  },
  play: async ({ canvasElement }) => {
    const svg = within(canvasElement).getByRole("img");
    await expect(svg).toBeTruthy();
    // Sun disc (main dot) , the glow ring is r=14 only during daytime, so
    // at least two circles exist beyond the 4px sunrise/sunset endpoint markers.
    const circles = canvasElement.querySelectorAll("svg circle");
    await expect(circles.length).toBeGreaterThanOrEqual(2);
  },
};

/** Sun just above the horizon at the left (sunrise) end of the arc. */
export const Sunrise: Story = {
  args: {
    idPrefix: "story-sunrise",
    nowMs: SUNRISE_NOW,
    dims: CLOCK_DIMS,
  },
  play: async ({ canvasElement }) => {
    const svg = within(canvasElement).getByRole("img");
    await expect(svg).toBeTruthy();
    const circles = canvasElement.querySelectorAll("svg circle");
    await expect(circles.length).toBeGreaterThanOrEqual(2);
  },
};

/** Sun just above the horizon approaching the right (sunset) end of the arc. */
export const Sunset: Story = {
  args: {
    idPrefix: "story-sunset",
    nowMs: SUNSET_NOW,
    dims: CLOCK_DIMS,
  },
  play: async ({ canvasElement }) => {
    const svg = within(canvasElement).getByRole("img");
    await expect(svg).toBeTruthy();
    const circles = canvasElement.querySelectorAll("svg circle");
    await expect(circles.length).toBeGreaterThanOrEqual(2);
  },
};

/** Sun below horizon , night state. Disc is dim/greyed. */
export const BelowHorizon: Story = {
  args: {
    idPrefix: "story-night",
    nowMs: NIGHT_NOW,
    dims: CLOCK_DIMS,
  },
  play: async ({ canvasElement }) => {
    const svg = within(canvasElement).getByRole("img");
    await expect(svg).toBeTruthy();
    // During night isDaytime=false: glow ring has r=0, but the main disc (r=5)
    // and both endpoint markers (r=4 each) still render.
    const circles = canvasElement.querySelectorAll("svg circle");
    await expect(circles.length).toBeGreaterThanOrEqual(2);
  },
};

/** Wide-and-shallow dims , 680×200, the alternate CLOCK_DIMS preset. */
export const ClockModalDims: Story = {
  args: {
    idPrefix: "story-clock",
    nowMs: DAYTIME_NOW,
    dims: CLOCK_DIMS,
  },
  play: async ({ canvasElement }) => {
    const svg = canvasElement.querySelector("svg");
    await expect(svg).not.toBeNull();
    await expect(svg?.getAttribute("width")).toBe("680");
    await expect(svg?.getAttribute("height")).toBe("200");
  },
};

/** Weather modal dims , 600×220, matching WeatherModalSunDayArc. */
export const WeatherModalDims: Story = {
  args: {
    idPrefix: "story-weather",
    nowMs: DAYTIME_NOW,
    dims: WEATHER_DIMS,
  },
  play: async ({ canvasElement }) => {
    const svg = canvasElement.querySelector("svg");
    await expect(svg).not.toBeNull();
    await expect(svg?.getAttribute("width")).toBe("600");
    await expect(svg?.getAttribute("height")).toBe("220");
  },
};
