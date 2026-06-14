/**
 * Stories for ClockModalCountdownHorizon , the "Countdown Horizon" clock detail modal.
 * Grouped under "Modals/Clock" (overlay surface → plain dark wrapper in Storybook).
 * Pure render stories , no play functions needed for the POC.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { modalDocsParameters } from "../__stories__/factory";
import { ClockModalCountdownHorizon } from "./ClockModalCountdownHorizon";

// ─── fixtures ─────────────────────────────────────────────────────────────────

/** A realistic spread of events across the next 45 days, including one today. */
const upcomingEvents = [
  { name: "Dentist appointment", place: "Smile Studio, Koreatown", days: 0 },
  { name: "Flight to NYC", place: "LAX Terminal 3", days: 3 },
  { name: "Team offsite", place: "Santa Monica, CA", days: 11 },
  { name: "Zero's vet checkup", place: "Silver Lake Animal Clinic", days: 18 },
  { name: "Car registration due", place: "DMV Los Feliz", days: 30 },
  { name: "Birthday dinner – Alex", place: "n/naka, Palms", days: 45 },
];

/** Events spread without any today, to show the non-today visual state. */
const futureOnlyEvents = [
  { name: "Flight to NYC", place: "LAX Terminal 3", days: 3 },
  { name: "Team offsite", place: "Santa Monica, CA", days: 11 },
  { name: "Zero's vet checkup", place: "Silver Lake Animal Clinic", days: 18 },
  { name: "Car registration due", place: "DMV Los Feliz", days: 30 },
];

// ─── meta ─────────────────────────────────────────────────────────────────────

const meta = {
  title: "Modals/Clock/Countdown Horizon",
  component: ClockModalCountdownHorizon,
  tags: ["autodocs"],
  parameters: modalDocsParameters(),
  args: {
    open: true,
    onClose: fn(),
    todayLabel: "Saturday, May 31, 2026",
    events: upcomingEvents,
  },
} satisfies Meta<typeof ClockModalCountdownHorizon>;

export default meta;
type Story = StoryObj<typeof meta>;

// ─── Primary: Countdown Horizon (today event + spread) ────────────────────────

export const CountdownHorizon: Story = {
  name: "Countdown Horizon , with today event",
};

// ─── Future only , no today event ─────────────────────────────────────────────

export const FutureOnly: Story = {
  name: "Countdown Horizon , future events only",
  args: {
    todayLabel: "Sunday, June 7, 2026",
    events: futureOnlyEvents,
  },
};

// ─── Single event ─────────────────────────────────────────────────────────────

export const SingleEvent: Story = {
  name: "Single event , ruler anchors to one point",
  args: {
    todayLabel: "Monday, June 1, 2026",
    events: [{ name: "Flight to NYC", place: "LAX Terminal 3", days: 7 }],
  },
};

// ─── Empty state ──────────────────────────────────────────────────────────────

export const Empty: Story = {
  name: "Empty , no upcoming events",
  args: {
    events: [],
  },
};
