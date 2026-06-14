/**
 * Clock tile , live wiring for its detail-modal variants.
 *
 * Data sources (all live, already exposed):
 *  - trpc.weather.now → sunrise/sunset ISO + formatted (solar variants)
 *  - trpc.events.list → upcoming events (countdown variant)
 *  - client wall clock (useNow) → current instant
 *  - config/world-clocks → which zones to display (configuration, not data)
 */

import { ClockModalCountdownHorizon } from "@/components/tiles/modals/ClockModalCountdownHorizon";
import { ClockModalSolarDayArc } from "@/components/tiles/modals/ClockModalSolarDayArc";
import { ClockModalTimeOfDayRhythm } from "@/components/tiles/modals/ClockModalTimeOfDayRhythm";
import { ClockModalWorldClocks } from "@/components/tiles/modals/ClockModalWorldClocks";
import type { LiveVariant, TileModalEntry } from "@/components/tiles/modals/types";
import { WORLD_CLOCK_ZONES } from "@/config/world-clocks";
import { POLL, useNow } from "@/lib/hooks";
import { trpc } from "@/lib/trpc";

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function useClockVariants(): { variants: LiveVariant[]; loading: boolean } {
  const now = useNow();
  const weather = trpc.weather.now.useQuery(undefined, { refetchInterval: POLL.weather });
  const events = trpc.events.list.useQuery(undefined);

  const w = weather.data;
  const ev = events.data;
  // Solar + countdown variants need their data; world-clocks needs none. Wait for
  // both queries so the switcher list is stable rather than popping variants in.
  if (!w || !ev) return { variants: [], loading: true };

  const todayLabel = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const variants: LiveVariant[] = [
    {
      slug: "solar-day-arc",
      label: "Solar Arc",
      render: (open, onClose) => (
        <ClockModalSolarDayArc
          open={open}
          onClose={onClose}
          sunriseIso={w.sunriseIso}
          sunsetIso={w.sunsetIso}
          tomorrowSunriseIso={w.tomorrowSunriseIso}
          nowMs={now.getTime()}
        />
      ),
    },
    {
      slug: "time-of-day-rhythm",
      label: "Day Rhythm",
      render: (open, onClose) => (
        <ClockModalTimeOfDayRhythm
          open={open}
          onClose={onClose}
          sunriseIso={w.sunriseIso}
          sunsetIso={w.sunsetIso}
          sunriseFormatted={formatTime(w.sunriseIso)}
          sunsetFormatted={formatTime(w.sunsetIso)}
          nowMs={now.getTime()}
        />
      ),
    },
    {
      slug: "countdown-horizon",
      label: "Countdown",
      render: (open, onClose) => (
        <ClockModalCountdownHorizon
          open={open}
          onClose={onClose}
          todayLabel={todayLabel}
          events={ev.map((e) => ({ name: e.name, place: e.place, days: e.days }))}
        />
      ),
    },
    {
      slug: "world-clocks",
      label: "World",
      render: (open, onClose) => (
        <ClockModalWorldClocks open={open} onClose={onClose} now={now} zones={WORLD_CLOCK_ZONES} />
      ),
    },
  ];

  return { variants, loading: false };
}

export const clockModalEntry: TileModalEntry = {
  tileId: "tile_clock",
  defaultSlug: "solar-day-arc",
  useVariants: useClockVariants,
};
