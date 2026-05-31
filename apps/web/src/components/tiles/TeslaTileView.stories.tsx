import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { TeslaTileView } from "./TeslaTileView";

// Storybook stories for TeslaTileView covering all visual states.
// The @storybook/addon-vitest plugin runs these as component tests.

const meta = {
  title: "Tiles/TeslaTileView",
  component: TeslaTileView,
  tags: ["autodocs"],
  parameters: {
    // BoardDecorator in preview.tsx wraps every story in the dark board background.
    layout: "padded",
  },
} satisfies Meta<typeof TeslaTileView>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Story: Loading (Skeleton) ─────────────────────────────────────────────────

export const Loading: Story = {
  args: { status: "loading" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Skeleton state: tile container renders, no header text
    const tile = canvasElement.querySelector(".tile");
    expect(tile).toBeTruthy();
    expect(canvas.queryByText("Tesla")).toBeNull();
    expect(canvas.queryByText(/\d+%/)).toBeNull();
  },
};

// ── Story: Error / empty state ────────────────────────────────────────────────

export const ErrorState: Story = {
  name: "Error / empty",
  args: { status: "error" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Error falls through to TeslaSkeleton — same appearance as loading
    const tile = canvasElement.querySelector(".tile");
    expect(tile).toBeTruthy();
    expect(canvas.queryByText("Tesla")).toBeNull();
  },
};

// ── Story: Populated — locked, not charging ───────────────────────────────────

export const Populated: Story = {
  args: {
    status: "populated",
    locked: true,
    charging: false,
    rate: 0,
    pct: 80,
    range: 240,
    odo: "12,345 mi",
    climate: 72,
    lat: 34.0537,
    lon: -118.2428,
    place: "Home",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("Tesla")).toBeTruthy();
    expect(canvas.getByText("Locked")).toBeTruthy();
    expect(canvas.getByText("Idle")).toBeTruthy();
    expect(canvas.getByText("80%")).toBeTruthy();
    expect(canvas.getByText("240 mi")).toBeTruthy();
    expect(canvas.getByText("12,345 mi")).toBeTruthy();
    expect(canvas.getByText("72°F")).toBeTruthy();
  },
};

// ── Story: Populated — unlocked, charging ────────────────────────────────────

export const Charging: Story = {
  args: {
    status: "populated",
    locked: false,
    charging: true,
    rate: 25,
    pct: 55,
    range: 165,
    odo: "12,345 mi",
    climate: 68,
    lat: 34.0537,
    lon: -118.2428,
    place: "Home",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("Tesla")).toBeTruthy();
    expect(canvas.getByText("Unlocked")).toBeTruthy();
    // Charging pill renders rate inline
    expect(canvas.getByText(/Charging/)).toBeTruthy();
    expect(canvas.getByText(/25 mi\/hr/)).toBeTruthy();
    expect(canvas.queryByText("Idle")).toBeNull();
    expect(canvas.getByText("55%")).toBeTruthy();
    expect(canvas.getByText("165 mi")).toBeTruthy();
    expect(canvas.getByText("68°F")).toBeTruthy();
  },
};

// ── Story: Populated — no GPS location (null lat/lon) ────────────────────────

export const NoLocation: Story = {
  name: "Populated — no GPS",
  args: {
    status: "populated",
    locked: true,
    charging: false,
    rate: 0,
    pct: 91,
    range: 273,
    odo: "10,001 mi",
    climate: 70,
    lat: null,
    lon: null,
    place: "Location unavailable",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Tile still renders fully with null coordinates; map defaults to home center
    expect(canvas.getByText("Tesla")).toBeTruthy();
    expect(canvas.getByText("Locked")).toBeTruthy();
    expect(canvas.getByText("91%")).toBeTruthy();
    expect(canvas.getByText("Location unavailable")).toBeTruthy();
  },
};
