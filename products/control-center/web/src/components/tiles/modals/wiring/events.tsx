/**
 * Events tile , live wiring for its detail-modal variants.
 *
 * Data source (live, already exposed):
 *  - trpc.events.list → upcoming events { id, name, place, days, date }
 *    (the router now surfaces the DB row's real `date` timestamptz as ISO-8601
 *    plus the row `id` the manage variant needs to target edit/delete).
 *
 * The four read variants share the same query. Countdown/FullAgenda/TimelineGaps
 * take the base { name, place, days } shape; MonthGrid additionally consumes the
 * real `date` field plus a `today` ISO date string derived from the client wall
 * clock. The Manage variant is the write surface: it wires the create/update/
 * delete mutations and invalidates the list on settle.
 */

import { EventsModalCountdownSpotlight } from "@/components/tiles/modals/EventsModalCountdownSpotlight";
import { EventsModalFullAgenda } from "@/components/tiles/modals/EventsModalFullAgenda";
import { EventsModalManage } from "@/components/tiles/modals/EventsModalManage";
import { EventsModalMonthGrid } from "@/components/tiles/modals/EventsModalMonthGrid";
import { EventsModalTimelineGaps } from "@/components/tiles/modals/EventsModalTimelineGaps";
import type { LiveVariant, TileModalEntry } from "@/components/tiles/modals/types";
import { trpc } from "@/lib/trpc";

function useEventsVariants(): { variants: LiveVariant[]; loading: boolean } {
  const events = trpc.events.list.useQuery(undefined);
  const utils = trpc.useUtils();

  const invalidate = () => {
    utils.events.list.invalidate();
  };
  const createEvent = trpc.events.create.useMutation({ onSettled: invalidate });
  const updateEvent = trpc.events.update.useMutation({ onSettled: invalidate });
  const deleteEvent = trpc.events.delete.useMutation({ onSettled: invalidate });

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
  // Manage variant needs the full row incl. id so it can target edit/delete.
  const manageRows = ev.map((e) => ({
    id: e.id,
    name: e.name,
    place: e.place,
    days: e.days,
    date: e.date,
  }));
  // Reference "today" for the grid , a real ISO date string from the wall clock.
  const today = new Date().toISOString().slice(0, 10);

  const busy = createEvent.isPending || updateEvent.isPending || deleteEvent.isPending;

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
    {
      slug: "manage",
      label: "Manage",
      render: (open, onClose) => (
        <EventsModalManage
          open={open}
          onClose={onClose}
          events={manageRows}
          busy={busy}
          onCreate={(draft) => createEvent.mutate(draft)}
          onUpdate={(id, draft) => updateEvent.mutate({ id, ...draft })}
          onDelete={(id) => deleteEvent.mutate({ id })}
        />
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
