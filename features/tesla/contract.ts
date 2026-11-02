import { z } from "zod";

const entity = (domain: string) => z.string().regex(new RegExp(`^${domain}\\.[a-z0-9_]+$`));
export const teslaEntitiesSchema = z
  .object({
    battery: entity("sensor"),
    range: entity("sensor"),
    charging: z.string().regex(/^(sensor|binary_sensor)\.[a-z0-9_]+$/),
    power: entity("sensor"),
    odometer: entity("sensor"),
    temperature: entity("sensor"),
    lock: entity("lock"),
    climate: entity("climate"),
    chargeSwitch: entity("switch"),
  })
  .strict();
export type TeslaEntities = z.infer<typeof teslaEntitiesSchema>;

export const teslaDataSchema = z.object({
  batteryPercent: z.number().min(0).max(100),
  rangeMiles: z.number().nonnegative().max(10_000),
  chargingState: z.enum([
    "charging",
    "stopped",
    "complete",
    "disconnected",
    "no_power",
    "starting",
  ]),
  chargePowerKW: z.number().nonnegative().max(1_000),
  locked: z.boolean(),
  climateOn: z.boolean(),
  cabinFahrenheit: z.number().min(-100).max(250),
  odometerMiles: z.number().nonnegative().max(10_000_000),
});
export const teslaStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ready"), data: teslaDataSchema }),
  z.object({
    status: z.enum(["unconfigured", "unavailable"]),
    data: z.null(),
    reason: z.string().optional(),
  }),
]);
export type TeslaState = z.infer<typeof teslaStateSchema>;
const teslaActionSchema = z.enum([
  "lock",
  "unlock",
  "climateOn",
  "climateOff",
  "chargeStart",
  "chargeStop",
]);
export type TeslaAction = z.infer<typeof teslaActionSchema>;
export const teslaCommandSchema = z
  .object({
    action: teslaActionSchema,
    pin: z.string().regex(/^\d{6}$/),
  })
  .strict();
