import { defineWorkerCycles } from "@app-kit";
import { getLogger } from "@www/logger";
import { turnOnAlarmLights } from "./lights";
import { alarmService } from "./service";

export async function runAlarmCycle(
  service = alarmService,
  lights = turnOnAlarmLights,
  now = new Date(),
) {
  const fired = await service.claimDue(now);
  if (fired) getLogger().info({ fired }, "alarms fired");
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
]);
