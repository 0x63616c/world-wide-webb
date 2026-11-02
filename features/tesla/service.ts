import { type HaEntity, type HomeAssistantClient, haFromConfig } from "@www/core";
import { ENV } from "@www/platform/env";
import {
  type TeslaAction,
  type TeslaEntities,
  type TeslaState,
  teslaDataSchema,
  teslaEntitiesSchema,
} from "./contract";
import { discoverTeslaEntities } from "./discovery";

type Client = Pick<
  HomeAssistantClient,
  "isConfigured" | "getAllEntities" | "getEntity" | "callService"
>;
export class TeslaUnavailable extends Error {}

export function parseEntities(raw: string | undefined): TeslaEntities | null {
  try {
    return teslaEntitiesSchema.parse(JSON.parse(raw ?? ""));
  } catch {
    return null;
  }
}

function number(entity: HaEntity): number {
  if (!entity.state.trim()) throw new TeslaUnavailable();
  const value = Number(entity.state);
  if (!Number.isFinite(value)) throw new TeslaUnavailable();
  return value;
}
function distance(entity: HaEntity): number {
  const value = number(entity);
  switch (entity.attributes.unit_of_measurement) {
    case "mi":
      return value;
    case "km":
      return value / 1.609344;
    default:
      throw new TeslaUnavailable();
  }
}

export function createTeslaService(client: Client, entities: () => TeslaEntities | null) {
  let cached: { ids: TeslaEntities; expires: number } | null = null;
  let discovering: Promise<TeslaEntities> | null = null;
  async function resolveEntities(): Promise<TeslaEntities> {
    const explicit = entities();
    if (explicit) return explicit;
    if (cached && cached.expires > Date.now()) return cached.ids;
    if (!discovering) {
      discovering = (async () => {
        const result = discoverTeslaEntities(await client.getAllEntities());
        if (!result.entities)
          throw new TeslaUnavailable(`Missing Tesla entities: ${result.missing.join(", ")}`);
        cached = { ids: result.entities, expires: Date.now() + 5 * 60_000 };
        return result.entities;
      })();
    }
    try {
      return await discovering;
    } finally {
      discovering = null;
    }
  }
  return {
    async state(): Promise<TeslaState> {
      if (!client.isConfigured()) return { status: "unconfigured", data: null };
      try {
        const ids = await resolveEntities();
        const [battery, range, charging, power, odometer, temperature, lock, climate] =
          await Promise.all(
            [
              ids.battery,
              ids.range,
              ids.charging,
              ids.power,
              ids.odometer,
              ids.temperature,
              ids.lock,
              ids.climate,
            ].map((id) => client.getEntity(id)),
          );
        if (
          !battery ||
          !range ||
          !charging ||
          !power ||
          !odometer ||
          !temperature ||
          !lock ||
          !climate
        )
          throw new TeslaUnavailable();
        if (battery.attributes.unit_of_measurement !== "%") throw new TeslaUnavailable();
        if (!["locked", "unlocked"].includes(lock.state)) throw new TeslaUnavailable();
        if (
          !["off", "heat_cool", "heat", "cool", "auto", "dry", "fan_only"].includes(climate.state)
        )
          throw new TeslaUnavailable();
        const unit = temperature.attributes.unit_of_measurement;
        if (unit !== "°C" && unit !== "°F") throw new TeslaUnavailable();
        const powerUnit = power.attributes.unit_of_measurement;
        if (powerUnit !== "W" && powerUnit !== "kW") throw new TeslaUnavailable();
        const data = teslaDataSchema.parse({
          batteryPercent: number(battery),
          rangeMiles: distance(range),
          chargingState: charging.entity_id.startsWith("binary_sensor.")
            ? ({ on: "charging", off: "stopped" } as Record<string, string>)[charging.state]
            : charging.state.toLowerCase().replaceAll(" ", "_").replace("nopower", "no_power"),
          chargePowerKW: number(power) / (powerUnit === "W" ? 1000 : 1),
          locked: lock.state === "locked",
          climateOn: climate.state !== "off",
          cabinFahrenheit: unit === "°C" ? (number(temperature) * 9) / 5 + 32 : number(temperature),
          odometerMiles: distance(odometer),
        });
        return { status: "ready", data };
      } catch (error) {
        cached = null;
        return {
          status: "unavailable",
          data: null,
          ...(error instanceof TeslaUnavailable && error.message ? { reason: error.message } : {}),
        };
      }
    },
    async command(action: TeslaAction): Promise<{ accepted: true }> {
      if (!client.isConfigured()) throw new TeslaUnavailable();
      try {
        const ids = await resolveEntities();
        const targets: Record<TeslaAction, [string, string, string]> = {
          lock: ["lock", "lock", ids.lock],
          unlock: ["lock", "unlock", ids.lock],
          climateOn: ["climate", "turn_on", ids.climate],
          climateOff: ["climate", "turn_off", ids.climate],
          chargeStart: ["switch", "turn_on", ids.chargeSwitch],
          chargeStop: ["switch", "turn_off", ids.chargeSwitch],
        };
        const [domain, service, id] = targets[action];
        await client.callService(domain, service, { entity_id: id });
      } catch {
        cached = null;
        throw new TeslaUnavailable();
      }
      // HA acknowledges a service call, not the resulting vehicle state.
      return { accepted: true };
    },
  };
}

const config = ENV.pick("HA_URL", "HA_TOKEN", "TESLA_ENTITIES");
export const teslaService = createTeslaService(haFromConfig(config), () =>
  parseEntities(config.TESLA_ENTITIES),
);
