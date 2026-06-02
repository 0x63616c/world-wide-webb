/**
 * Stories for ClockModalTimeOfDayRhythm — "Time-of-Day Rhythm" vertical ribbon.
 *
 * View-driven (all data + callbacks via props). Grouped under "Modals/Clock".
 * Render-only stories (no play functions) — sufficient for a layout POC.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ClockModalTimeOfDayRhythm } from "./ClockModalTimeOfDayRhythm";

// ─── meta ─────────────────────────────────────────────────────────────────────

const meta = {
  title: "Modals/Clock/Time Of Day Rhythm",
  component: ClockModalTimeOfDayRhythm,
  tags: ["autodocs"],
  args: {
    open: true,
    onClose: fn(),
  },
} satisfies Meta<typeof ClockModalTimeOfDayRhythm>;

export default meta;
type Story = StoryObj<typeof meta>;

// ─── Time-of-Day Rhythm — evening (primary state) ─────────────────────────────
//
// Current time is 6:42 PM (18:42). Phase = Evening, ~3h until Night (22:00).
// Sun has already set; no "Daylight left" stat shown. Represents the state the
// wall panel most often shows after the working day.

export const TimeOfDayRhythm: Story = {
  name: "Time-of-Day Rhythm — evening",
  args: {
    sunriseIso: "2026-05-31T06:02:00",
    sunsetIso: "2026-05-31T19:48:00",
    sunriseFormatted: "6:02 AM",
    sunsetFormatted: "7:48 PM",
    // 18:42:00 local — Evening bucket, ~1h until sunset, ~3h 18m until Night
    nowMs: new Date("2026-05-31T18:42:00").getTime(),
  },
};

// ─── Early morning — approaching sunrise ──────────────────────────────────────
//
// 5:15 AM: just crossed into Morning but sunrise is still ~47 min away.
// "Daylight left" stat is visible and large (full day ahead). Shows the
// boundary between Night and Morning bands sitting just below the now-line,
// with the sun marker below the current position.

export const EarlyMorning: Story = {
  name: "Early morning — approaching sunrise",
  args: {
    sunriseIso: "2026-05-31T06:02:00",
    sunsetIso: "2026-05-31T19:48:00",
    sunriseFormatted: "6:02 AM",
    sunsetFormatted: "7:48 PM",
    // 5:15 AM — Morning bucket, 6h 45m until Afternoon, ~13h 46m daylight remaining
    nowMs: new Date("2026-05-31T05:15:00").getTime(),
  },
};
