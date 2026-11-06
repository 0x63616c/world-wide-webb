import {
  createFeatureDb,
  createPgDeviceStateStore,
  deviceState,
  type HaEntity,
  type HomeAssistantClient,
  haFromConfig,
} from "@www/core";
import { getLogger } from "@www/logger";
import { ENV } from "@www/platform/env";
import {
  type TeslaAction,
  type TeslaEntities,
  type TeslaState,
  teslaDataSchema,
  teslaEntitiesSchema,
} from "./contract";
import { discoverTeslaEntities } from "./discovery";
import { createTeslaSnapshotStore, type TeslaSnapshotStore } from "./snapshot-store";

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

export function createTeslaService(
  client: Client,
  entities: () => TeslaEntities | null,
  snapshots?: TeslaSnapshotStore,
) {
  let lastKnown: Extract<TeslaState, { status: "ready" }> | null = null;
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
        // Optional update telemetry must never make the rest of the car unavailable.
        const update = ids.softwareUpdate
          ? await client.getEntity(ids.softwareUpdate).catch(() => null)
          : null;
        const updateStatus =
          update?.attributes.in_progress === true
            ? "installing"
            : update?.state === "on"
              ? "available"
              : update?.state === "off"
                ? "up_to_date"
                : undefined;
        const softwareUpdate = updateStatus
          ? {
              status: updateStatus,
              ...(typeof update?.attributes.installed_version === "string"
                ? { installedVersion: update.attributes.installed_version }
                : {}),
              ...(typeof update?.attributes.latest_version === "string"
                ? { latestVersion: update.attributes.latest_version }
                : {}),
            }
          : undefined;
        const data = teslaDataSchema.parse({
          softwareUpdate,
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
        const now = new Date();
        lastKnown = { status: "ready", data, stale: false, lastUpdatedAt: now.toISOString() };
        if (snapshots) {
          try {
            await snapshots.write(data, now);
          } catch {
            getLogger().warn("Could not persist Tesla telemetry");
          }
        }
        return lastKnown;
      } catch (error) {
        cached = null;
        if (!lastKnown && snapshots) {
          try {
            lastKnown = await snapshots.read();
          } catch {
            getLogger().warn("Could not read cached Tesla telemetry");
          }
        }
        if (lastKnown) return { ...lastKnown, stale: true };
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

const config = ENV.pick("HA_URL", "HA_TOKEN", "TESLA_ENTITIES", "DATABASE_URL");
export const teslaService = createTeslaService(
  haFromConfig(config),
  () => parseEntities(config.TESLA_ENTITIES),
  createTeslaSnapshotStore(
    createPgDeviceStateStore(createFeatureDb(config.DATABASE_URL, { deviceState })),
  ),
);
