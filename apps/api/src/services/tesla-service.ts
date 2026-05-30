import { ha } from "../integrations/homeassistant";
import type { HaEntity } from "../integrations/homeassistant/types";

export interface TeslaData {
  name: string;
  nick: string;
  locked: boolean;
  place: string;
  lat: number | null;
  lon: number | null;
  charging: boolean;
  rate: number;
  pct: number;
  range: number;
  odo: string;
  climate: number;
}

/** Placeholder used when HA is unconfigured or all entities are missing. */
export const TESLA_PLACEHOLDER: TeslaData = {
  name: "Model Y",
  nick: "Evee",
  pct: 82,
  charging: true,
  rate: 25,
  range: 264,
  odo: "24,113",
  locked: true,
  place: "Home",
  lat: null,
  lon: null,
  climate: 70,
};

function isTeslaEntity(e: HaEntity): boolean {
  return (
    e.entity_id.toLowerCase().includes("tesla") || e.entity_id.toLowerCase().includes("model_y")
  );
}

function findByDomainAndKeyword(
  entities: HaEntity[],
  domain: string,
  keywords: string[],
): HaEntity | undefined {
  return entities.find(
    (e) =>
      e.entity_id.startsWith(`${domain}.`) &&
      isTeslaEntity(e) &&
      keywords.some((kw) => e.entity_id.toLowerCase().includes(kw)),
  );
}

function safeFloat(val: unknown, fallback: number): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function formatOdo(miles: number): string {
  return Math.round(miles).toLocaleString("en-US");
}

export async function getTeslaData(): Promise<TeslaData> {
  if (!ha.isConfigured()) {
    return TESLA_PLACEHOLDER;
  }

  // Fetch all states from HA and filter to tesla-related entities.
  // We use getEntities per domain but fetching all states once is more efficient;
  // the public API only exposes per-domain. Instead, fetch each domain we need.
  let entities: HaEntity[];
  try {
    const domains = ["sensor", "binary_sensor", "lock", "device_tracker"];
    const results = await Promise.allSettled(domains.map((d) => ha.getEntities(d)));
    entities = results
      .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
      .filter(isTeslaEntity);
  } catch {
    return TESLA_PLACEHOLDER;
  }

  if (entities.length === 0) {
    return TESLA_PLACEHOLDER;
  }

  // Battery / charge level
  const batteryEntity =
    findByDomainAndKeyword(entities, "sensor", ["battery", "charge_level", "soc"]) ??
    findByDomainAndKeyword(entities, "sensor", ["battery"]);
  const pct = batteryEntity
    ? Math.round(safeFloat(batteryEntity.state, TESLA_PLACEHOLDER.pct))
    : TESLA_PLACEHOLDER.pct;

  // Charging binary sensor
  const chargingEntity = findByDomainAndKeyword(entities, "binary_sensor", ["charging"]);
  const charging = chargingEntity ? chargingEntity.state === "on" : TESLA_PLACEHOLDER.charging;

  // Charge rate (mi/hr or kW; we take the numeric value as-is)
  const rateEntity = findByDomainAndKeyword(entities, "sensor", ["charge_rate", "charging_rate"]);
  const rate = rateEntity
    ? safeFloat(rateEntity.state, TESLA_PLACEHOLDER.rate)
    : TESLA_PLACEHOLDER.rate;

  // Range
  const rangeEntity = findByDomainAndKeyword(entities, "sensor", ["range"]);
  const range = rangeEntity
    ? Math.round(safeFloat(rangeEntity.state, TESLA_PLACEHOLDER.range))
    : TESLA_PLACEHOLDER.range;

  // Odometer
  const odoEntity = findByDomainAndKeyword(entities, "sensor", ["odometer"]);
  const odo = odoEntity ? formatOdo(safeFloat(odoEntity.state, 0)) : TESLA_PLACEHOLDER.odo;

  // Climate / cabin temp
  const climateEntity = findByDomainAndKeyword(entities, "sensor", [
    "inside_temp",
    "cabin_temp",
    "interior_temp",
  ]);
  const climate = climateEntity
    ? Math.round(safeFloat(climateEntity.state, TESLA_PLACEHOLDER.climate))
    : TESLA_PLACEHOLDER.climate;

  // Lock
  const lockEntity =
    findByDomainAndKeyword(entities, "lock", ["lock"]) ??
    entities.find((e) => e.entity_id.startsWith("lock.") && isTeslaEntity(e));
  const locked = lockEntity ? lockEntity.state === "locked" : TESLA_PLACEHOLDER.locked;

  // Device tracker for lat/lon/place
  const trackerEntity =
    findByDomainAndKeyword(entities, "device_tracker", ["location", "tracker", "position"]) ??
    entities.find((e) => e.entity_id.startsWith("device_tracker.") && isTeslaEntity(e));
  const lat = trackerEntity ? safeFloat(trackerEntity.attributes.latitude, 0) || null : null;
  const lon = trackerEntity ? safeFloat(trackerEntity.attributes.longitude, 0) || null : null;
  const place =
    (trackerEntity?.attributes.location_name as string | undefined) ?? TESLA_PLACEHOLDER.place;

  return {
    name: "Model Y",
    nick: "Evee",
    locked,
    place,
    lat,
    lon,
    charging,
    rate,
    pct,
    range,
    odo,
    climate,
  };
}
