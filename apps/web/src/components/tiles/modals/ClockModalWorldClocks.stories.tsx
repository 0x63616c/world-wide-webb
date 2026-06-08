/**
 * Stories for ClockModalWorldClocks — world-clocks expanded view for the Clock tile.
 * View-driven: all data + callbacks via props. Grouped under "Modals/Clock" since
 * this is an overlay surface, not a tile board entry.
 *
 * `now` is pinned to a fixed Date so snapshots are deterministic — the actual
 * board passes a live ticking Date.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import { modalDocsParameters } from "../__stories__/factory";
import type { ClockModalWorldClocksProps } from "./ClockModalWorldClocks";
import { ClockModalWorldClocks } from "./ClockModalWorldClocks";

// ─── fixtures ─────────────────────────────────────────────────────────────────

// Fixed "now" — Saturday 2026-05-30 at 14:37 Los Angeles time (UTC-7).
// Chosen so the LA row shows afternoon and Tokyo/Sydney show different day states.
const fixedNow = new Date("2026-05-30T21:37:00.000Z");

// Full world spread: home (LA) + four major zones.
const globalZones = [
  { city: "Los Angeles", tz: "America/Los_Angeles", home: true },
  { city: "New York", tz: "America/New_York" },
  { city: "London", tz: "Europe/London" },
  { city: "Tokyo", tz: "Asia/Tokyo" },
  { city: "Sydney", tz: "Australia/Sydney" },
];

// Minimal set — home only, verifying the panel renders cleanly with a single row.
const homeOnlyZones = [{ city: "Los Angeles", tz: "America/Los_Angeles", home: true }];

// ─── meta ─────────────────────────────────────────────────────────────────────

const meta = {
  title: "Modals/Clock/World Clocks",
  component: ClockModalWorldClocks,
  tags: ["autodocs"],
  parameters: modalDocsParameters(),
  args: {
    open: true,
    onClose: fn(),
    now: fixedNow,
    zones: globalZones,
  },
} satisfies Meta<typeof ClockModalWorldClocks>;

export default meta;
type Story = StoryObj<typeof meta>;

// ─── World Clocks (interactive) ───────────────────────────────────────────────

// Stateful wrapper so backdrop/Escape/Close actually dismiss in Storybook.
// A "Reopen" button makes the story replayable after closing.
function InteractiveWorldClocks(args: ClockModalWorldClocksProps) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Reopen
      </button>
      <ClockModalWorldClocks
        {...args}
        open={open}
        onClose={() => {
          setOpen(false);
          args.onClose();
        }}
      />
    </>
  );
}

export const WorldClocks: Story = {
  name: "World Clocks — 5 zones",
  render: (args) => <InteractiveWorldClocks {...args} />,
};

// ─── Home only ────────────────────────────────────────────────────────────────

// Single home row — verifies the divider doesn't render and the accent styling
// applies correctly when there are no other zones.
export const HomeOnly: Story = {
  name: "Home only — Los Angeles",
  args: { zones: homeOnlyZones },
};

// ─── Closed ───────────────────────────────────────────────────────────────────

// Verifies the modal renders nothing when open=false — nothing leaks onto the
// board while closed.
export const Closed: Story = {
  name: "Closed — modal not mounted",
  args: { open: false },
};
