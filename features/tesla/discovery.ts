import type { HaEntity } from "@www/core";
import { TESLA_ENTITY_PREFIX } from "../ac/config";
import { type TeslaEntities, teslaEntitiesSchema } from "./contract";

/** Pure, deterministic matching; state values do not affect entity identity. */
export function discoverTeslaEntities(all: readonly HaEntity[]): {
  entities: TeslaEntities | null;
  missing: (keyof TeslaEntities)[];
} {
  const candidates = all
    .filter((e) => e.entity_id.split(".")[1]?.startsWith(`${TESLA_ENTITY_PREFIX}_`))
    .sort((a, b) => a.entity_id.localeCompare(b.entity_id));
  const found: Partial<TeslaEntities> = {};
  for (const role of Object.keys(teslaEntitiesSchema.shape) as (keyof TeslaEntities)[]) {
    let best = 0;
    for (const entity of candidates) {
      const score = matchScore(role, entity);
      if (score > best) {
        best = score;
        found[role] = entity.entity_id;
      }
    }
  }
  const missing = (Object.keys(teslaEntitiesSchema.shape) as (keyof TeslaEntities)[]).filter(
    (role) => !found[role],
  );
  const parsed = teslaEntitiesSchema.safeParse(found);
  return { entities: parsed.success ? parsed.data : null, missing };
}

function matchScore(role: keyof TeslaEntities, entity: HaEntity): number {
  const [domain, objectId = ""] = entity.entity_id.split(".");
  const name = objectId.slice(TESLA_ENTITY_PREFIX.length + 1);
  const unit = entity.attributes.unit_of_measurement;
  const deviceClass = entity.attributes.device_class;
  // Prefer the canonical name, then a suffix (some integrations include API paths).
  const suffix = (...names: string[]) => {
    const index = names.findIndex((n) => name === n || name.endsWith(`_${n}`));
    return index < 0 ? 0 : 100 - index + (name === names[index] ? 100 : 0);
  };
  switch (role) {
    case "battery":
      return domain === "sensor" && unit === "%"
        ? suffix("battery_level", "battery") || (deviceClass === "battery" ? 10 : 0)
        : 0;
    case "range":
      return domain === "sensor" && (unit === "mi" || unit === "km")
        ? suffix("battery_range", "range", "rated_range")
        : 0;
    case "charging":
      return domain === "sensor" || domain === "binary_sensor"
        ? suffix("charging_state", "charging") +
            (suffix("charging_state", "charging") && domain === "sensor" ? 10 : 0)
        : 0;
    case "power":
      return domain === "sensor" && (unit === "W" || unit === "kW")
        ? suffix("charger_power", "charging_power")
        : 0;
    case "odometer":
      return domain === "sensor" && (unit === "mi" || unit === "km") ? suffix("odometer") : 0;
    case "temperature":
      return domain === "sensor" && (unit === "°C" || unit === "°F")
        ? suffix("inside_temperature", "temperature_inside", "inside_temp", "cabin_temperature")
        : 0;
    case "lock":
      return domain === "lock" && !/(charge|cable|port|trunk|frunk)/.test(name)
        ? suffix("lock", "doors", "door_lock") || 10
        : 0;
    case "climate":
      return domain === "climate" && !/(overheat|protection|seat)/.test(name)
        ? suffix("climate", "hvac") || 10
        : 0;
    case "chargeSwitch":
      return domain === "switch" && !/(scheduled|solar|port|cable)/.test(name)
        ? suffix("charge", "charger", "charging", "charging_state")
        : 0;
  }
}
