/**
 * useTimeSuiteLive , "is anything in the time suite live right now?"
 *
 * The clock detail wiring holds the board's idle reset/dim ONLY while the page
 * is open AND something is live (`useIdleHoldWhile(open && live, ...)`), so a
 * running timer keeps the page up past the idle window, while an idle World
 * Clock left open still dims and glides home (no overnight burn-in). One
 * selector so the wiring never restates the three stores' liveness rules.
 */

import { useAlarmFiring } from "./alarm-store";
import { useStopwatch } from "./stopwatch-store";
import { useTimers, useTimersRinging } from "./timer-store";

export function useTimeSuiteLive(): boolean {
  const timers = useTimers();
  const ringing = useTimersRinging();
  const stopwatch = useStopwatch();
  const firing = useAlarmFiring();
  return (
    ringing || timers.some((t) => t.state === "running") || stopwatch.running || firing !== null
  );
}
