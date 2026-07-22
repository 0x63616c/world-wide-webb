/**
 * TimerVariant , zero-prop wrapper binding ClockTimerView to the timer store.
 *
 * Mounted by the clock detail wiring as the `timer` variant. Owns the render
 * cadence: a 250 ms tick keeps the border ring's sweep and the final-seconds
 * digits smooth without the wiring hook ticking the whole variant tree (the
 * plan bans a top-level useNow in useClockVariants , only the mounted variant
 * that needs a clock runs one). All mutations are the store's module-level
 * setters , stable identities, no useCallback needed.
 */

import { useNow } from "@/lib/hooks";
import {
  addTimer,
  deleteTimer,
  dismissTimer,
  pauseTimer,
  restartTimer,
  resumeTimer,
  stopTimerRinging,
  useTimers,
} from "@/lib/time-suite/timer-store";
import { ClockTimerView } from "./ClockTimerView";

/** Ring/digit refresh cadence , 4 fps reads smooth at wall distance. */
const TICK_MS = 250;

/** Mounted by the clock detail wiring as the `timer` variant. */
export function TimerVariant() {
  const timers = useTimers();
  const nowMs = useNow(TICK_MS).getTime();
  return (
    <ClockTimerView
      timers={timers}
      nowMs={nowMs}
      onAdd={addTimer}
      onPause={pauseTimer}
      onResume={resumeTimer}
      onDelete={deleteTimer}
      onDismiss={dismissTimer}
      onRestart={restartTimer}
      onStopRinging={stopTimerRinging}
    />
  );
}
