/**
 * Stories for ClockModalSolarDayArc , the solar horizon arc detail modal.
 * Grouped under "Modals/" (not "Tiles/") matching the ExpandedControls precedent.
 * Pure view: all data + callbacks via props, no trpc.
 *
 * nowMs is a fixed snapshot in each story so the sun dot and countdowns render
 * deterministically regardless of when Storybook runs.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { modalDocsParameters } from "../__stories__/factory";
import { ClockModalSolarDayArc } from "./ClockModalSolarDayArc";

// ─── fixtures ─────────────────────────────────────────────────────────────────

// Primary: mid-afternoon in Los Angeles , sun is well past noon, golden-hour
// approaching soon. Matches the real Los Angeles lat/lon seasonally.
const midAfternoon = {
  sunriseIso: "2026-05-31T05:58:00",
  sunsetIso: "2026-05-31T20:02:00",
  tomorrowSunriseIso: "2026-06-01T05:57:00",
  // 15:30 local → roughly 70% through the daylight window
  nowMs: new Date("2026-05-31T15:30:00").getTime(),
};

// Secondary: pre-dawn , sun has not risen yet. Sun dot parks at the left tip,
// daylight remaining shows "--", pill counts down to this morning's sunrise.
const preDawn = {
  sunriseIso: "2026-05-31T05:58:00",
  sunsetIso: "2026-05-31T20:02:00",
  tomorrowSunriseIso: "2026-06-01T05:57:00",
  // 04:30 local , well before sunrise
  nowMs: new Date("2026-05-31T04:30:00").getTime(),
};

// Tertiary: after sunset , sun has set, overnight countdown to tomorrow's sunrise.
const afterSunset = {
  sunriseIso: "2026-05-31T05:58:00",
  sunsetIso: "2026-05-31T20:02:00",
  tomorrowSunriseIso: "2026-06-01T05:57:00",
  // 21:15 local , 73 minutes after sunset
  nowMs: new Date("2026-05-31T21:15:00").getTime(),
};

// ─── meta ─────────────────────────────────────────────────────────────────────

const meta = {
  title: "Modals/Clock/Solar Day Arc",
  component: ClockModalSolarDayArc,
  tags: ["autodocs"],
  parameters: modalDocsParameters(),
  args: {
    open: true,
    onClose: fn(),
    ...midAfternoon,
  },
} satisfies Meta<typeof ClockModalSolarDayArc>;

export default meta;
type Story = StoryObj<typeof meta>;

// ─── Solar Day Arc , mid-afternoon (primary) ──────────────────────────────────

export const SolarDayArc: Story = {
  name: "Solar Day Arc , mid-afternoon",
  args: midAfternoon,
};

// ─── Pre-Dawn , before sunrise ────────────────────────────────────────────────

export const PreDawn: Story = {
  name: "Pre-Dawn , counting down to sunrise",
  args: preDawn,
};

// ─── After Sunset , overnight countdown ──────────────────────────────────────

export const AfterSunset: Story = {
  name: "After Sunset , overnight to tomorrow's sunrise",
  args: afterSunset,
};

// ─── Closed , modal not open ──────────────────────────────────────────────────

export const Closed: Story = {
  name: "Closed , modal not open",
  args: { open: false, ...midAfternoon },
};
