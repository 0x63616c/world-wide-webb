/**
 * Stories for EventsModalFullAgenda — the full upcoming-events agenda modal.
 * View-driven (all data + callbacks via props). Grouped under "Modals/" since
 * this is an overlay surface, not a tile, so it falls through the BoardDecorator
 * to the plain dark wrapper.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import type { EventsModalFullAgendaProps } from "./EventsModalFullAgenda";
import { EventsModalFullAgenda } from "./EventsModalFullAgenda";

// ─── fixtures ─────────────────────────────────────────────────────────────────

// A realistic full agenda with a mix of urgency states — some within the
// 3-day threshold (accented), some well out. Sorted ascending by days (soonest
// first) matching the router's pre-sorted output.
const fullAgendaEvents = [
  { name: "Dentist appointment", place: "Midtown Dental Group", days: 0 },
  { name: "Call with architect", place: "Google Meet", days: 1 },
  { name: "Dry cleaning pickup", place: "Martinizing on 6th", days: 3 },
  { name: "Birthday dinner — Maya", place: "Nobu Downtown LA", days: 7 },
  { name: "Oil change", place: "Jiffy Lube, Sunset Blvd", days: 9 },
  { name: "Flight to SF", place: "LAX Terminal 1", days: 14 },
  { name: "Conference — React Summit", place: "Moscone Center, SF", days: 15 },
  { name: "Return flight", place: "SFO Terminal 2", days: 17 },
  { name: "Lease renewal signing", place: "Home Leasing", days: 22 },
  { name: "Annual physical", place: "Cedars-Sinai Medical", days: 31 },
];

// A short list that matches exactly what the tile shows — verifies the modal
// adds value over the tile even when there are only a few events.
const shortAgendaEvents = [
  { name: "Coffee with Jordan", place: "Go Get Em Tiger, Silver Lake", days: 2 },
  { name: "Package delivery window", place: "Home", days: 4 },
  { name: "Haircut", place: "Fellow Barber, DTLA", days: 6 },
];

// ─── meta ─────────────────────────────────────────────────────────────────────

const meta = {
  title: "Modals/Events/Full Agenda",
  component: EventsModalFullAgenda,
  tags: ["autodocs"],
  args: {
    open: true,
    onClose: fn(),
    events: fullAgendaEvents,
  },
} satisfies Meta<typeof EventsModalFullAgenda>;

export default meta;
type Story = StoryObj<typeof meta>;

// ─── Full Agenda (interactive) ────────────────────────────────────────────────

// Stateful wrapper so backdrop/Escape/Close actually dismiss in Storybook.
// A "Reopen" button makes the story replayable after closing.
function InteractiveFullAgenda(args: EventsModalFullAgendaProps) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Reopen
      </button>
      <EventsModalFullAgenda
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

export const FullAgenda: Story = {
  name: "Full Agenda — 10 events",
  render: (args) => <InteractiveFullAgenda {...args} />,
};

// ─── Short list ───────────────────────────────────────────────────────────────

// Fewer events than the tile's 3-event limit — the modal still shows them all
// with the same urgency language, no truncation.
export const ShortList: Story = {
  name: "Short list — 3 events",
  args: { events: shortAgendaEvents },
};

// ─── Empty ────────────────────────────────────────────────────────────────────

// No upcoming events in the DB — renders the empty state rather than an empty
// list, so the user knows the data loaded but there's simply nothing upcoming.
export const Empty: Story = {
  name: "Empty — no upcoming events",
  args: { events: [] },
};

// ─── Closed ───────────────────────────────────────────────────────────────────

// Verifies the modal renders nothing when open=false — matches the pattern from
// the Controls modal stories (nothing leaks onto the board while the tile loads).
export const Closed: Story = {
  name: "Closed — modal not mounted",
  args: { open: false },
};
