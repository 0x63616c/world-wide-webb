/**
 * Events tile , live wiring for its detail-page variants.
 *
 * Data source (live, already exposed):
 *  - trpc.events.list → upcoming events { id, name, place, days, date }
 *    (the router now surfaces the DB row's real `date` timestamptz as ISO-8601
 *    plus the row `id` the manage variant needs to target edit/delete).
 *    Past events are excluded unless `includePast` is passed; `days` is negative
 *    for those, so `days === 0` means today and nothing else.
 *
 * The four read variants share the same query. Countdown/FullAgenda/TimelineGaps
 * take the base { name, place, days } shape; MonthGrid additionally consumes the
 * real `date` field plus a `today` ISO date string derived from the client wall
 * clock. The Manage variant is the write surface: it wires the create/update/
 * delete mutations and invalidates the list on settle.
 */

import type { DetailVariant, TileDetailPageEntry } from "@/components/tiles/detail/types";
import { EventsModalCountdownSpotlight } from "@/components/tiles/views/EventsModalCountdownSpotlight";
import { EventsModalFullAgenda } from "@/components/tiles/views/EventsModalFullAgenda";
import { EventsModalManage } from "@/components/tiles/views/EventsModalManage";
import { EventsModalMonthGrid } from "@/components/tiles/views/EventsModalMonthGrid";
import { EventsModalTimelineGaps } from "@/components/tiles/views/EventsModalTimelineGaps";
import { trpc } from "@/lib/trpc";

function useEventsVariants(): { variants: DetailVariant[]; loading: boolean } {
  // Read variants show what's ahead; manage also needs the stale rows so they
  // can be edited or deleted.
  const events = trpc.events.list.useQuery(undefined);
  const allEvents = trpc.events.list.useQuery({ includePast: true });
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
  const manageRows = (allEvents.data ?? ev).map((e) => ({
    id: e.id,
    name: e.name,
    place: e.place,
    days: e.days,
    date: e.date,
  }));
  // Reference "today" for the grid , a real ISO date string from the wall clock.
  const today = new Date().toISOString().slice(0, 10);

  const busy = createEvent.isPending || updateEvent.isPending || deleteEvent.isPending;

  const variants: DetailVariant[] = [
    {
      slug: "full-agenda",
      label: "Agenda",
      render: () => <EventsModalFullAgenda events={base} />,
    },
    {
      slug: "countdown-spotlight",
      label: "Countdown",
      render: () => <EventsModalCountdownSpotlight events={base} />,
    },
    {
      slug: "timeline-gaps",
      label: "Timeline",
      render: () => <EventsModalTimelineGaps events={base} />,
    },
    {
      slug: "month-grid",
      label: "Month",
      render: () => <EventsModalMonthGrid events={withDate} today={today} />,
    },
    {
      slug: "manage",
      label: "Manage",
      render: () => (
        <EventsModalManage
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

export const eventsDetailEntry: TileDetailPageEntry = {
  kind: "page",
  tileId: "tile_event",
  title: "Upcoming",
  defaultSlug: "full-agenda",
  useVariants: useEventsVariants,
};
