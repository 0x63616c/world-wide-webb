/**
 * time-suite pure helpers , side-effect-free formatting/derivation functions
 * shared by the stores and the pure views.
 *
 * Living apart from the store modules is load-bearing: evaluating a store
 * module runs its boot() side effects (localStorage read, persist, `storage`
 * listener, possibly playCue), which a Storybook/RTL render of a pure view
 * must never trigger. Views import ONLY from here; the stores import these
 * same functions for their own recomputes.
 */

import type { AlarmRecord, StopwatchLap, StopwatchState } from "./types";

// ─── alarm wall-clock math + formatting ───────────────────────────────────────

/** ISO weekday list guard: integers 1-7 (Mon..Sun), no duplicates. */
export function validRepeatDays(days: number[]): boolean {
  return (
    days.every((d) => Number.isInteger(d) && d >= 1 && d <= 7) && new Set(days).size === days.length
  );
}

/**
 * The next instant this alarm's wall time occurs strictly after `nowMs`,
 * honoring `repeatDays` (ISO 1-7 Mon..Sun; [] = next occurrence, today or
 * tomorrow). Local-time Date rolling, so DST adjustments come out iOS-like.
 *
 * Returns null when no day within the next week matches , only possible for an
 * invalid `repeatDays` (out-of-range entries), which the store's guards and
 * `isAlarmRecord` reject at the boundaries; callers treat null as "no
 * deadline", i.e. the alarm never fires.
 *
 * @public , pinned pure API (clock-suite plan §2.3).
 */
export function computeNextFireAtMs(
  alarm: Pick<AlarmRecord, "hour" | "minute" | "repeatDays">,
  nowMs: number,
): number | null {
  const candidate = new Date(nowMs);
  candidate.setHours(alarm.hour, alarm.minute, 0, 0);
  // ≤8 iterations always suffices: 7 weekdays + the possibly-passed today.
  for (let i = 0; i < 8; i++) {
    if (candidate.getTime() > nowMs) {
      const isoDay = candidate.getDay() === 0 ? 7 : candidate.getDay();
      if (alarm.repeatDays.length === 0 || alarm.repeatDays.includes(isoDay)) {
        return candidate.getTime();
      }
    }
    candidate.setDate(candidate.getDate() + 1);
    // Re-anchor the wall time for the new day , stepping across a DST boundary
    // shifts the clock, and re-setting keeps 07:30 meaning 07:30 local.
    candidate.setHours(alarm.hour, alarm.minute, 0, 0);
  }
  return null;
}

/** "7:30 AM" , 12-hour panel formatting shared by the rows and the banner. */
export function formatAlarmTime(hour: number, minute: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const mm = String(minute).padStart(2, "0");
  return `${h12}:${mm} ${hour < 12 ? "AM" : "PM"}`;
}

const DAY_SHORT: Record<number, string> = {
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
  7: "Sun",
};

function sameDaySet(a: number[], b: number[]): boolean {
  return a.length === b.length && b.every((d) => a.includes(d));
}

/** Row subtitle: when this alarm fires next, in panel words. */
export function nextFireDescription(alarm: AlarmRecord, nowMs: number): string {
  if (!alarm.enabled) return "Off";
  const time = formatAlarmTime(alarm.hour, alarm.minute);
  const days = alarm.repeatDays;
  if (days.length === 7) return `Every day, ${time}`;
  if (days.length > 0) {
    if (sameDaySet(days, [1, 2, 3, 4, 5])) return `Weekdays, ${time}`;
    if (sameDaySet(days, [6, 7])) return `Weekends, ${time}`;
    const names = [...days].sort((a, b) => a - b).map((d) => DAY_SHORT[d]);
    return `${names.join(" ")}, ${time}`;
  }
  // One-shot: always within the next 24 h, so Today or Tomorrow. A null next
  // (unreachable for a valid record) reads as no upcoming fire.
  const next = alarm.nextFireAtMs ?? computeNextFireAtMs(alarm, nowMs);
  if (next === null) return "Off";
  const today = new Date(nowMs).toDateString();
  const when = new Date(next).toDateString() === today ? "Today" : "Tomorrow";
  return `${when}, ${time}`;
}

// ─── stopwatch derivations ────────────────────────────────────────────────────

/** Elapsed at `nowMs`: accumulated spans plus the live one while running. */
export function stopwatchElapsedMs(s: StopwatchState, nowMs: number): number {
  return s.accumulatedMs + (s.running && s.startedAtMs !== null ? nowMs - s.startedAtMs : 0);
}

/**
 * Fastest/slowest COMPLETED lap ids for the Apple-style tinting; both null
 * until there are ≥2 completed laps (a single lap is neither fast nor slow).
 */
export function lapExtremes(laps: StopwatchLap[]): {
  fastestId: string | null;
  slowestId: string | null;
} {
  if (laps.length < 2) return { fastestId: null, slowestId: null };
  let fastest = laps[0];
  let slowest = laps[0];
  for (const lap of laps) {
    if (lap.ms < fastest.ms) fastest = lap;
    if (lap.ms > slowest.ms) slowest = lap;
  }
  return { fastestId: fastest.id, slowestId: slowest.id };
}
