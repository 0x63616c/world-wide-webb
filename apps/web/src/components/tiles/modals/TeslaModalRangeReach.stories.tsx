/**
 * Stories for TeslaModalRangeReach — isochrone-style range-reach overlay.
 * Grouped under "Modals/Tesla" (not "Tiles/") matching the established pattern.
 * Pure view: all data via props, fn() stubs for callbacks.
 *
 * Two primary states capture the most meaningful reads of the modal:
 *   1. "Range Reach" — car parked away from home with comfortable range.
 *   2. "Tight Margin" — battery low, range barely covers the trip home.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import type { TeslaModalRangeReachProps } from "./TeslaModalRangeReach";
import { TeslaModalRangeReach } from "./TeslaModalRangeReach";

// ─── fixtures ─────────────────────────────────────────────────────────────────

// Car parked near Silverlake (~6 mi northeast of home). 78% charge, 214 mi
// range — the circle envelops home with headroom. Verdict: Reachable.
const primaryData: Omit<TeslaModalRangeReachProps, "open" | "onClose"> = {
  pct: 78,
  rangeMiles: 214,
  carLat: 34.0875,
  carLon: -118.2532,
};

// Car parked near Culver City (~7 mi southwest of home). 11% charge, 28 mi
// range — just enough to get home but well within the 5 mi safety buffer.
// Verdict: Tight — low margin.
const tightData: Omit<TeslaModalRangeReachProps, "open" | "onClose"> = {
  pct: 11,
  rangeMiles: 28,
  carLat: 34.0055,
  carLon: -118.3964,
};

// ─── meta ─────────────────────────────────────────────────────────────────────

const meta = {
  title: "Modals/Tesla/Range Reach",
  component: TeslaModalRangeReach,
  tags: ["autodocs"],
  args: {
    open: true,
    onClose: fn(),
    ...primaryData,
  },
} satisfies Meta<typeof TeslaModalRangeReach>;

export default meta;
type Story = StoryObj<typeof meta>;

// ─── Range Reach — comfortable (primary) ──────────────────────────────────────

export const RangeReach: Story = {
  name: "Range Reach — comfortable margin",
  args: primaryData,
};

// ─── Tight Margin — amber warning ────────────────────────────────────────────

export const TightMargin: Story = {
  name: "Tight Margin — low charge, barely reachable",
  args: tightData,
};
