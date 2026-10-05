import { ENV } from "@www/platform/env";
import { lightTargetSchema } from "./contract";

export const config = ENV.pick(
  "DATABASE_URL",
  "HA_URL",
  "HA_TOKEN",
  "ALARM_API_TOKEN",
  "ALARM_LIGHT_TARGET",
  "ALARM_SNOOZE_MINUTES",
);

export function alarmDefaults() {
  const snoozeMinutes = config.ALARM_SNOOZE_MINUTES;
  if (snoozeMinutes < 1 || snoozeMinutes > 60) throw new Error("ALARM_SNOOZE_MINUTES must be 1–60");
  return { snoozeMinutes, lightTarget: lightTargetSchema.parse(config.ALARM_LIGHT_TARGET) };
}
