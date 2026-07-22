/**
 * Shared record shapes for the time suite (timer / stopwatch / alarm stores).
 *
 * All three stores persist device-locally under versioned `cc-*-v1` localStorage
 * envelopes (`{ v: 1, ... }`). The panel is a single fixed wall device, so a
 * timer or alarm is a property of THIS installation (same argument as
 * `pushEnabled` in lib/settings.ts). The `{ v: 1 }` envelope + globally-unique
 * `prefix_<uuid>` ids keep the door open for the eventual DB-table + tRPC home
 * without a breaking migration.
 */

export interface TimerRecord {
  /** "timer_" + crypto.randomUUID() */
  id: string;
  label: string | null;
  durationMs: number;
  /** Absolute deadline while RUNNING; null otherwise. Absolute so drift,
   *  background throttling, and deploy reloads are all free. */
  endsAtMs: number | null;
  /** Authoritative while PAUSED. Derived (`max(0, endsAtMs - now)`) elsewhere. */
  remainingMs: number;
  state: "running" | "paused" | "done";
  /** Set at completion; drives the nag window. */
  doneAtMs: number | null;
  /** True once the user stopped the ringing (or the nag auto-silenced). */
  dismissedCue: boolean;
  createdAtMs: number;
}

export interface StopwatchLap {
  /** "lap_" + crypto.randomUUID(). "Lap N" labels derive from list position
   *  (list is kept newest first), never from the id. */
  id: string;
  /** Completed lap length. */
  ms: number;
}

export interface StopwatchState {
  running: boolean;
  /** Wall-clock start of the current running span; null while stopped. */
  startedAtMs: number | null;
  /** Elapsed accumulated across previous spans (excludes the live span). */
  accumulatedMs: number;
  /** Elapsed-at-lap-start for the in-progress lap. */
  lapStartElapsedMs: number;
  /** Completed laps, newest first. */
  laps: StopwatchLap[];
}

export interface AlarmRecord {
  /** "alarm_" + crypto.randomUUID() */
  id: string;
  label: string | null;
  /** 0-23, local wall hour. */
  hour: number;
  /** 0-59, local wall minute. */
  minute: number;
  /** ISO weekday numbers 1-7 (Mon..Sun); [] = one-shot. */
  repeatDays: number[];
  enabled: boolean;
  /** Absolute next-fire instant , the single firing authority. Null iff
   *  disabled. Recomputed on add/edit/enable/fire (see alarm-store). */
  nextFireAtMs: number | null;
}

export interface AlarmStoreState {
  alarms: AlarmRecord[];
  /** The ringing alarm, until dismissed / auto-stopped. */
  firing: { alarmId: string; sinceMs: number } | null;
}

/**
 * Boot grace window shared by the timer + alarm stores: a deadline that passed
 * within this window of a (deploy-)reload still fires its cue on load , an
 * unlucky deploy in a timer's final seconds must not eat the beep. Anything
 * older resolves silently (done timers stay, stale one-shot alarms disable,
 * stale repeats roll forward).
 */
export const BOOT_GRACE_MS = 60_000;
