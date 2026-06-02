/**
 * Events tile — live wiring for its detail-modal variants.
 *
 * Data source (live, already exposed):
 *  - trpc.events.list → upcoming events { name, place, days, date }
 *    (the router now surfaces the DB row's real `date` timestamptz as ISO-8601).
 *
 * The four variants share the same query. Countdown/FullAgenda/TimelineGaps take
 * the base { name, place, days } shape; MonthGrid additionally consumes the real
 * `date` field plus a `today` ISO date string derived from the client wall clock.
 */

import { trpc } from "../../../../lib/trpc";
import { EventsModalCountdownSpotlight } from "../EventsModalCountdownSpotlight";
import { EventsModalFullAgenda } from "../EventsModalFullAgenda";
import { EventsModalMonthGrid } from "../EventsModalMonthGrid";
import { EventsModalTimelineGaps } from "../EventsModalTimelineGaps";
import type { LiveVariant, TileModalEntry } from "../types";

function useEventsVariants(): { variants: LiveVariant[]; loading: boolean } {
  const events = trpc.events.list.useQuery(undefined);

  const ev = events.data;
  if (!ev) return { variants: [], loading: true };

  // Base shape for the three day-only variants.
  const base = ev.map((e) => ({ name: e.name, place: e.place, days: e.days }));
  // Widened shape (adds real ISO date) for the month grid.
  const withDate = ev.map((e) => ({
    name: e.name,
    place: e.place,
    days: e.days,
    date: e.date,
  }));
  // Reference "today" for the grid — a real ISO date string from the wall clock.
  const today = new Date().toISOString().slice(0, 10);

  const variants: LiveVariant[] = [
    {
      slug: "full-agenda",
      label: "Agenda",
      render: (open, onClose) => (
        <EventsModalFullAgenda open={open} onClose={onClose} events={base} />
      ),
    },
    {
      slug: "countdown-spotlight",
      label: "Countdown",
      render: (open, onClose) => (
        <EventsModalCountdownSpotlight open={open} onClose={onClose} events={base} />
      ),
    },
    {
      slug: "timeline-gaps",
      label: "Timeline",
      render: (open, onClose) => (
        <EventsModalTimelineGaps open={open} onClose={onClose} events={base} />
      ),
    },
    {
      slug: "month-grid",
      label: "Month",
      render: (open, onClose) => (
        <EventsModalMonthGrid open={open} onClose={onClose} events={withDate} today={today} />
      ),
    },
  ];

  return { variants, loading: false };
}

export const eventsModalEntry: TileModalEntry = {
  tileId: "tile_event",
  defaultSlug: "full-agenda",
  useVariants: useEventsVariants,
};
