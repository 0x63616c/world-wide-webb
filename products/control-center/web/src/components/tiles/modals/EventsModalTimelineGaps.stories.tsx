/**
 * Stories for EventsModalTimelineGaps , the "Runway Timeline" expanded view.
 * View-driven (all data + callbacks via props). Grouped under "Modals/" since
 * this is an overlay surface, consistent with ExpandedControls.
 *
 * Primary story shows a realistic spread of events to demonstrate the spacing
 * analytic: two clustered events soon + two distant events later. The secondary
 * story shows the empty state when no events are scheduled.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import { modalDocsParameters } from "../__stories__/factory";
import type { EventsModalTimelineGapsProps } from "./EventsModalTimelineGaps";
import { EventsModalTimelineGaps } from "./EventsModalTimelineGaps";

// ─── fixtures ─────────────────────────────────────────────────────────────────

// Clustered near-term events followed by a long gap then two spread-out events.
// This arrangement exercises the proportional spacing: the first two nodes are
// visually close, a "+37d" gap label appears before the third, then another
// large gap before the fourth , demonstrating the density analytic at a glance.
const eventsSpread = [
  { name: "Dentist Appointment", place: "Downtown Dental", days: 2 },
  { name: "Sarah's Birthday Dinner", place: "Nobu LA", days: 4 },
  { name: "Annual Lease Renewal", place: "Property Management Office", days: 41 },
  { name: "Flight to NYC", place: "LAX Terminal 6", days: 89 },
  { name: "Conference Keynote", place: "Javits Center", days: 91 },
];

// A compact cluster: all events within 10 days , spine nodes pack tight,
// showing the other end of the density spectrum.
const eventsClustered = [
  { name: "Team Sync", place: "Zoom", days: 1 },
  { name: "Gym PT Session", place: "Equinox WeHo", days: 3 },
  { name: "Haircut", place: "Tommy Gun's", days: 7 },
];

// ─── meta ─────────────────────────────────────────────────────────────────────

const meta = {
  title: "Modals/Events/Timeline Gaps",
  component: EventsModalTimelineGaps,
  tags: ["autodocs"],
  parameters: modalDocsParameters(),
  args: {
    open: true,
    onClose: fn(),
    events: eventsSpread,
  },
} satisfies Meta<typeof EventsModalTimelineGaps>;

export default meta;
type Story = StoryObj<typeof meta>;

// ─── Interactive wrapper ───────────────────────────────────────────────────────

// Stateful so backdrop/Escape/Close actually dismiss in Storybook; a "Reopen"
// button makes the story replayable after closing.
function InteractiveWrapper(args: EventsModalTimelineGapsProps) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Reopen
      </button>
      <EventsModalTimelineGaps
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

// ─── Runway Timeline , spread events ─────────────────────────────────────────

export const RunwayTimeline: Story = {
  name: "Runway Timeline , spread events",
  render: (args) => <InteractiveWrapper {...args} />,
};

// ─── Dense cluster , all events within a week ────────────────────────────────

export const DenseCluster: Story = {
  name: "Dense cluster , events within a week",
  render: (args) => <InteractiveWrapper {...args} />,
  args: {
    events: eventsClustered,
  },
};

// ─── Empty , no upcoming events ───────────────────────────────────────────────

export const Empty: Story = {
  name: "Empty , no upcoming events",
  args: {
    events: [],
  },
};
