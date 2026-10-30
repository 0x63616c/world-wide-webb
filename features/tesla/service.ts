import { type HaEntity, type HomeAssistantClient, haFromConfig } from "@www/core";
import { ENV } from "@www/platform/env";
import {
  type TeslaAction,
  type TeslaEntities,
  type TeslaState,
  teslaDataSchema,
  teslaEntitiesSchema,
} from "./contract";

type Client = Pick<HomeAssistantClient, "isConfigured" | "getEntity" | "callService">;
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
  return {
    async state(): Promise<TeslaState> {
      const ids = entities();
      if (!ids || !client.isConfigured()) return { status: "unconfigured", data: null };
      try {
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
          chargingState: charging.state.toLowerCase().replaceAll(" ", "_"),
          chargePowerKW: number(power) / (powerUnit === "W" ? 1000 : 1),
          locked: lock.state === "locked",
          climateOn: climate.state !== "off",
          cabinFahrenheit: unit === "°C" ? (number(temperature) * 9) / 5 + 32 : number(temperature),
          odometerMiles: distance(odometer),
        });
        return { status: "ready", data };
      } catch {
        return { status: "unavailable", data: null };
      }
    },
    async command(action: TeslaAction): Promise<{ accepted: true }> {
      const ids = entities();
      if (!ids || !client.isConfigured()) throw new TeslaUnavailable();
      const targets: Record<TeslaAction, [string, string, string]> = {
        lock: ["lock", "lock", ids.lock],
        unlock: ["lock", "unlock", ids.lock],
        climateOn: ["climate", "turn_on", ids.climate],
        climateOff: ["climate", "turn_off", ids.climate],
        chargeStart: ["switch", "turn_on", ids.chargeSwitch],
        chargeStop: ["switch", "turn_off", ids.chargeSwitch],
      };
      const [domain, service, id] = targets[action];
      try {
        await client.callService(domain, service, { entity_id: id });
      } catch {
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
