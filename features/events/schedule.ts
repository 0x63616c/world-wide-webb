import type { AlarmInput } from "./contract";

type Schedule = Pick<AlarmInput, "time" | "timeZone" | "repeatDays" | "at">;
const DAY = 86_400_000;

function wallClock(timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  return (ms: number) => {
    const p = Object.fromEntries(
      formatter.formatToParts(ms).map(({ type, value }) => [type, value]),
    );
    return Date.UTC(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      Number(p.hour),
      Number(p.minute),
      Number(p.second),
    );
  };
}

function resolveWallTime(target: number, wall: (ms: number) => number): Date | null {
  const offsets = new Set([-DAY, 0, DAY].map((delta) => wall(target + delta) - (target + delta)));
  const first = [...offsets]
    .map((offset) => target - offset)
    .filter((ms) => wall(ms) === target)
    .sort((a, b) => a - b)
    .at(0);
  return first === undefined ? null : new Date(first);
}

/** Date picker input in a named zone, including DST gaps and folds. */
export function alarmOnDate(date: string, time: string, timeZone: string): Date | null {
  return resolveWallTime(Date.parse(`${date}T${time}:00Z`), wallClock(timeZone));
}

/** Next instant, strictly after `after`. Calendar days are in the alarm's zone.
 * DST: skip a nonexistent time; use only the FIRST instance of a repeated time.
 * Never add 24h to an instant to advance a repeating alarm. */
export function nextAlarmAt(schedule: Schedule, after: Date): Date | null {
  if (schedule.at) {
    const at = new Date(schedule.at);
    return at > after ? at : null;
  }
  const wall = wallClock(schedule.timeZone);
  const today = new Date(wall(after.getTime()));
  const [hour, minute] = schedule.time.split(":").map(Number);
  for (let day = 0; day <= 8; day++) {
    const date = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + day),
    );
    if (schedule.repeatDays.length && !schedule.repeatDays.includes(date.getUTCDay())) continue;
    const target = date.getTime() + (hour * 60 + minute) * 60_000;
    // Gather offsets on both sides of a possible transition (including half-hour DST).
    const first = resolveWallTime(target, wall);
    if (first && first > after) return first;
  }
  return null;
}

const MISSED_ALARM_GRACE_MS = 15 * 60_000;
export const RING_TIMEOUT_MS = 30 * 60_000;

export function dueAlarmPlan(alarm: Schedule & { nextFireAt: Date }, now: Date) {
  // A long outage can span several repetitions. Recover a RECENT occurrence
  // even when the persisted next_fire_at still points to yesterday's alarm.
  const recent = alarm.repeatDays.length
    ? nextAlarmAt(alarm, new Date(now.getTime() - MISSED_ALARM_GRACE_MS - 1))
    : null;
  const scheduledAt =
    recent && recent <= now && recent >= alarm.nextFireAt ? recent : alarm.nextFireAt;
  return {
    scheduledAt,
    ring: now.getTime() - scheduledAt.getTime() <= MISSED_ALARM_GRACE_MS,
    nextFireAt: alarm.repeatDays.length ? nextAlarmAt(alarm, now) : null,
  };
}
