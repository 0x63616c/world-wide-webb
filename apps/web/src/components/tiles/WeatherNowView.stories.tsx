/**
 * Stories for WeatherNowView — covers all visual states so addon-vitest
 * runs them as component tests in the vitest suite.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import type { WeatherNowViewProps } from "./WeatherNowView";
import { WeatherNowView } from "./WeatherNowView";

// Base populated args — all required populated-state fields.
const populatedBase: WeatherNowViewProps = {
  status: "populated",
  temp: "72",
  cond: "Partly Cloudy",
  hi: "78",
  lo: "65",
  feels: "70",
  hum: "58",
  wind: "8",
  city: "Los Angeles",
  solarLabel: "Sunset",
  solarValue: "7:52 PM",
};

const meta = {
  title: "Tiles/WeatherNowView",
  component: WeatherNowView,
  tags: ["autodocs"],
  // BoardDecorator is global in preview.tsx — no local decorator needed.
} satisfies Meta<typeof WeatherNowView>;

export default meta;
type Story = StoryObj<typeof meta>;

// ─── Loading (skeleton) ───────────────────────────────────────────────────────

export const Loading: Story = {
  args: {
    status: "loading",
  },
  play: async ({ canvasElement }) => {
    // Skeleton renders a .tile container but no weather data.
    const tile = canvasElement.querySelector(".tile");
    expect(tile).toBeInTheDocument();
    // Header title must be absent while loading.
    const canvas = within(canvasElement);
    expect(canvas.queryByText("Weather Now")).not.toBeInTheDocument();
  },
};

// ─── Error (skeleton fallback) ────────────────────────────────────────────────

export const ErrorState: Story = {
  args: {
    status: "error",
  },
  play: async ({ canvasElement }) => {
    // Error state renders same Skeleton layout — no stale/fake values shown.
    const tile = canvasElement.querySelector(".tile");
    expect(tile).toBeInTheDocument();
    const canvas = within(canvasElement);
    expect(canvas.queryByText("Weather Now")).not.toBeInTheDocument();
    // No invented dash values (e.g. "--°") when in error state.
    expect(canvas.queryByText(/--°/)).not.toBeInTheDocument();
  },
};

// ─── Populated — Sunset solar event ──────────────────────────────────────────

export const Populated: Story = {
  args: { ...populatedBase },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Tile header renders.
    expect(canvas.getByText("Weather Now")).toBeInTheDocument();

    // City name renders in right slot.
    expect(canvas.getByText("Los Angeles")).toBeInTheDocument();

    // Primary temperature with degree symbol.
    expect(canvas.getByText("72°")).toBeInTheDocument();

    // Condition text.
    expect(canvas.getByText("Partly Cloudy")).toBeInTheDocument();

    // Hi / Lo range.
    expect(canvas.getByText("H 78°")).toBeInTheDocument();
    expect(canvas.getByText("L 65°")).toBeInTheDocument();

    // Metric footer cells.
    expect(canvas.getByText("Feels")).toBeInTheDocument();
    expect(canvas.getByText("70°")).toBeInTheDocument();
    expect(canvas.getByText("Humidity")).toBeInTheDocument();
    expect(canvas.getByText("58%")).toBeInTheDocument();
    expect(canvas.getByText("Wind")).toBeInTheDocument();
    expect(canvas.getByText("8 mph")).toBeInTheDocument();

    // Solar event (Sunset).
    expect(canvas.getByText("Sunset")).toBeInTheDocument();
    expect(canvas.getByText("7:52 PM")).toBeInTheDocument();
  },
};

// ─── Populated — Sunrise solar event ─────────────────────────────────────────

// Sunrise label is shown after sunset until the next morning.
export const PopulatedSunrise: Story = {
  args: {
    ...populatedBase,
    solarLabel: "Sunrise",
    solarValue: "5:15 AM",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    expect(canvas.getByText("Sunrise")).toBeInTheDocument();
    expect(canvas.getByText("5:15 AM")).toBeInTheDocument();
    // Sunset must not appear when showing Sunrise.
    expect(canvas.queryByText("Sunset")).not.toBeInTheDocument();
  },
};
