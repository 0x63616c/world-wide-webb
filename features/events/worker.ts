import { defineWorkerCycles } from "@app-kit";
import { getLogger } from "@www/logger";
import { turnOnAlarmLights } from "./lights";
import { alarmService } from "./service";

export async function runAlarmCycle(service = alarmService, now = new Date()) {
  const fired = await service.claimDue(now);
  if (fired) getLogger().info({ fired }, "alarms fired");
}

// A slow/unreachable HA must not delay another alarm's durable ring. These
// cycles have independent interval-worker locks, and communicate through PG.
export async function runAlarmLightCycle(
  service = alarmService,
  lights = turnOnAlarmLights,
  now = new Date(),
) {
  await service.deliverLights(
    lights,
    (occurrenceId, err) => {
      getLogger().warn({ occurrenceId, err }, "alarm lights failed; retry scheduled");
    },
    now,
  );
}

export const cycles = defineWorkerCycles([
  {
    name: "alarm-clock",
    intervalMs: 1_000,
    runOnStart: true,
    run: () => runAlarmCycle(),
  },
  {
    name: "alarm-lights",
    intervalMs: 1_000,
    runOnStart: true,
    run: () => runAlarmLightCycle(),
  },
]);
