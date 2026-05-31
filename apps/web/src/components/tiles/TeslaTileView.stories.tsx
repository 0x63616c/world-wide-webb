import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { TeslaTileView } from "./TeslaTileView";

// Storybook stories for TeslaTileView covering all visual states.
// Play functions use storybook/test matchers (browser env); vitest component tests
// live in __tests__/TeslaTileView.stories.test.tsx via composeStories.

const meta = {
  title: "Tiles/TeslaTileView",
  component: TeslaTileView,
  tags: ["autodocs"],
  parameters: {
    // BoardDecorator in preview.tsx wraps every story in the dark board background.
    layout: "padded",
    // Stories are visual previews at board dimensions — not integration tests.
    viewport: { defaultViewport: "board" },
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
    expect(tile).not.toBeNull();
    expect(canvas.queryByText("Tesla")).not.toBeInTheDocument();
    expect(canvas.queryByText(/\d+%/)).not.toBeInTheDocument();
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
    expect(tile).not.toBeNull();
    expect(canvas.queryByText("Tesla")).not.toBeInTheDocument();
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
    expect(canvas.getByText("Tesla")).toBeInTheDocument();
    expect(canvas.getByText("Locked")).toBeInTheDocument();
    expect(canvas.getByText("Idle")).toBeInTheDocument();
    expect(canvas.getByText("80%")).toBeInTheDocument();
    expect(canvas.getByText("240 mi")).toBeInTheDocument();
    expect(canvas.getByText("12,345 mi")).toBeInTheDocument();
    expect(canvas.getByText("72°F")).toBeInTheDocument();
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
    expect(canvas.getByText("Tesla")).toBeInTheDocument();
    expect(canvas.getByText("Unlocked")).toBeInTheDocument();
    // Charging pill renders rate inline as "Charging · +25 mi/hr"
    expect(canvas.getByText(/Charging/)).toBeInTheDocument();
    expect(canvas.getByText(/\+25 mi\/hr/)).toBeInTheDocument();
    expect(canvas.queryByText("Idle")).not.toBeInTheDocument();
    expect(canvas.getByText("55%")).toBeInTheDocument();
    expect(canvas.getByText("165 mi")).toBeInTheDocument();
    expect(canvas.getByText("68°F")).toBeInTheDocument();
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
    expect(canvas.getByText("Tesla")).toBeInTheDocument();
    expect(canvas.getByText("Locked")).toBeInTheDocument();
    expect(canvas.getByText("91%")).toBeInTheDocument();
    expect(canvas.getByText("Location unavailable")).toBeInTheDocument();
  },
};
