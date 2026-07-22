/**
 * Clock tile , live wiring for its detail-page variants (clock-suite rework).
 *
 * Timer / Stopwatch / Alarm are the interactive trio (Apple Clock mental
 * model), each a zero-prop `*Variant` wrapper binding its pure view to its
 * `lib/time-suite` store. World and Countdown keep the surviving modal-era
 * pages behind thin local wrappers.
 *
 * Render-cadence law (plan §7): NO top-level `useNow()` here , a 1 s clock at
 * the hook level would re-render the whole variant tree, including a running
 * timer's 250 ms frames. Only the MOUNTED variant that needs a tick runs one:
 * `WorldClocksVariant`/`CountdownVariant` call `useNow()` themselves, and
 * `trpc.events.list` lives inside `CountdownVariant` (countdown-only data).
 * The variant list is static , `{ loading: false }` always , so the switcher
 * never pops; Countdown renders its own skeleton stack while events load.
 *
 * Idle: the page holds the board's glide-home/dim ONLY while something is live
 * (running timer, ringing timer, running stopwatch, firing alarm) via
 * `useIdleHoldWhile` , a dormant World Clock left open still idles home.
 */

import { ClockModalCountdownHorizon } from "@/components/tiles/views/ClockModalCountdownHorizon";
import { ClockModalWorldClocks } from "@/components/tiles/views/ClockModalWorldClocks";
import { Skeleton } from "@/components/ui";
import { WORLD_CLOCK_ZONES } from "@/config/world-clocks";
import { useNow } from "@/lib/hooks";
import { useIdleHoldWhile } from "@/lib/idle-hold-store";
import { useAlarmFiring } from "@/lib/time-suite/alarm-store";
import { useTimeSuiteLive } from "@/lib/time-suite/live";
import { useTimersRinging } from "@/lib/time-suite/timer-store";
import { trpc } from "@/lib/trpc";
import { AlarmVariant } from "../clock/AlarmVariant";
import { StopwatchVariant } from "../clock/StopwatchVariant";
import { TimerVariant } from "../clock/TimerVariant";
import type { DetailVariant, TileDetailPageEntry } from "../types";

/** World clocks , pure client-side Intl math off the wall clock; 1 s tick
 *  scoped here so only this variant re-renders while mounted. */
function WorldClocksVariant() {
  const now = useNow();
  return <ClockModalWorldClocks now={now} zones={WORLD_CLOCK_ZONES} />;
}

/** Countdown , owns its events query (countdown-only data) and a 1 s tick for
 *  the today label. Renders a skeleton stack while events load so the variant
 *  list itself never has to report loading. */
function CountdownVariant() {
  const now = useNow();
  const events = trpc.events.list.useQuery(undefined);

  const ev = events.data;
  if (!ev) {
    return (
      <div style={{ maxWidth: 920, margin: "0 auto" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
          <Skeleton w="60%" h={22} />
          <Skeleton w="100%" h={28} />
          <Skeleton w="100%" h={64} />
          <Skeleton w="100%" h={64} />
          <Skeleton w="100%" h={64} />
        </div>
      </div>
    );
  }

  const todayLabel = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <ClockModalCountdownHorizon
      todayLabel={todayLabel}
      events={ev.map((e) => ({ name: e.name, place: e.place, days: e.days }))}
    />
  );
}

function useClockVariants(): { variants: DetailVariant[]; loading: boolean } {
  // Hold the board's idle reset/dim only while something in the suite is live
  // (plan §3) , runs only while the page is open (active-only child).
  useIdleHoldWhile(useTimeSuiteLive(), "clock-detail-live");

  // Switcher badges (plan §5.2): a timer finishing , or an alarm firing ,
  // while the user is on ANOTHER variant of the open page must stay visible.
  const timerBadge = useTimersRinging();
  const alarmBadge = useAlarmFiring() !== null;

  const variants: DetailVariant[] = [
    { slug: "timer", label: "Timer", badge: timerBadge, render: () => <TimerVariant /> },
    { slug: "stopwatch", label: "Stopwatch", render: () => <StopwatchVariant /> },
    { slug: "alarm", label: "Alarm", badge: alarmBadge, render: () => <AlarmVariant /> },
    { slug: "world-clocks", label: "World", render: () => <WorldClocksVariant /> },
    { slug: "countdown-horizon", label: "Countdown", render: () => <CountdownVariant /> },
  ];

  // Static list , variants fetch/tick internally, the switcher never pops.
  return { variants, loading: false };
}

export const clockDetailEntry: TileDetailPageEntry = {
  kind: "page",
  tileId: "tile_clock",
  title: "Clock",
  defaultSlug: "timer",
  useVariants: useClockVariants,
};
