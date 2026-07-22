/**
 * AlarmVariant , zero-prop wrapper binding ClockAlarmView to the alarm store.
 *
 * Lives here (not in the wiring) so the wiring hook stays a thin variant list
 * and only the MOUNTED variant subscribes to its store (plan §7: no top-level
 * ticking hooks in useClockVariants). `useNow(30s)` is plenty for the row
 * subtitles , the only time-sensitive copy is Today/Tomorrow phrasing; the
 * firing bar is driven by the store's own tick, not this clock.
 */

import { useNow } from "@/lib/hooks";
import {
  addAlarm,
  deleteAlarm,
  dismissAlarmFiring,
  toggleAlarm,
  updateAlarm,
  useAlarmFiring,
  useAlarms,
} from "@/lib/time-suite/alarm-store";
import { ClockAlarmView } from "./ClockAlarmView";

/** Mounted by the clock detail wiring as the `alarm` variant. */
export function AlarmVariant() {
  const alarms = useAlarms();
  const firing = useAlarmFiring();
  const now = useNow(30_000);
  return (
    <ClockAlarmView
      alarms={alarms}
      firing={firing}
      nowMs={now.getTime()}
      onAdd={addAlarm}
      onUpdate={updateAlarm}
      onDelete={deleteAlarm}
      onToggle={toggleAlarm}
      onDismissFiring={dismissAlarmFiring}
    />
  );
}
