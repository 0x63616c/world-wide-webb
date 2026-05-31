import { findPlace } from "../config/places";
import { env } from "../env";
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

/**
 * Resolve the exact HA entity ids for the car. The Tesla Fleet / tesla_custom
 * integration names every entity `<prefix>_*` (prefix is the car nickname,
 * "evee"). Overridable via TESLA_ENTITY_PREFIX.
 */
export function teslaEntityIds(prefix = env.TESLA_ENTITY_PREFIX) {
  return {
    battery: `sensor.${prefix}_battery_level`,
    charging: `sensor.${prefix}_charging`,
    rate: `sensor.${prefix}_charge_rate`,
    range: `sensor.${prefix}_battery_range`,
    odometer: `sensor.${prefix}_odometer`,
    cabin: `sensor.${prefix}_inside_temperature`,
    lock: `lock.${prefix}_lock`,
    tracker: `device_tracker.${prefix}_location`,
  };
}

/** HA states that mean "no usable value" — car asleep or entity disabled. */
const DEAD_STATES = new Set(["unavailable", "unknown", "none", ""]);

function num(e: HaEntity | undefined, fallback: number): number {
  if (!e || DEAD_STATES.has(e.state)) return fallback;
  const n = Number(e.state);
  return Number.isFinite(n) ? n : fallback;
}

function titleCase(s: string): string {
  return s
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * Resolve the map-pill place name (CC-6gx): a curated named place wins when the
 * car's GPS is within its radius, otherwise the HA zone name title-cased. No
 * coords AND no zone → unknown location, return "" (no fabricated label).
 */
function resolvePlace(lat: number | null, lon: number | null, zoneState?: string): string {
  if (lat !== null && lon !== null) {
    const match = findPlace(lat, lon);
    if (match) return match.name;
  }
  return zoneState ? titleCase(zoneState) : "";
}

export async function getTeslaData(): Promise<TeslaData> {
  if (!ha.isConfigured()) throw new Error("Home Assistant is not configured");

  const ids = teslaEntityIds();
  const keys = Object.keys(ids) as (keyof typeof ids)[];
  const results = await Promise.allSettled(keys.map((k) => ha.getEntity(ids[k])));
  const map: Record<string, HaEntity> = {};
  results.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value) map[keys[i]] = r.value;
  });

  // If we couldn't read even the battery, treat the whole car as unavailable.
  if (!map.battery || DEAD_STATES.has(map.battery.state)) {
    throw new Error("Tesla battery entity unavailable");
  }

  const pct = Math.round(num(map.battery, 0));
  // `sensor.<car>_charging` is an enum: starting | charging | stopped | complete | disconnected | no_power
  const chargeState = map.charging?.state ?? "";
  const charging = chargeState === "charging" || chargeState === "starting";
  const rate = num(map.rate, 0);
  const range = Math.round(num(map.range, 0));
  const climate = Math.round(num(map.cabin, 0));

  // Odometer is often disabled in the integration, or reads unknown/unavailable
  // while the car sleeps — honest absence is "—", not a fabricated number.
  const odo =
    map.odometer && !DEAD_STATES.has(map.odometer.state)
      ? Math.round(num(map.odometer, 0)).toLocaleString("en-US")
      : "—";

  const locked = map.lock ? map.lock.state === "locked" : false;

  const tracker = map.tracker;
  const latAttr = tracker ? Number(tracker.attributes.latitude) : Number.NaN;
  const lonAttr = tracker ? Number(tracker.attributes.longitude) : Number.NaN;
  const lat = Number.isFinite(latAttr) ? latAttr : null;
  const lon = Number.isFinite(lonAttr) ? lonAttr : null;
  // Prefer a curated named place when the car's GPS is within its radius (CC-6gx);
  // otherwise fall back to the raw HA zone name, title-cased. With no tracker and
  // no coords the location is genuinely unknown — show nothing rather than invent one.
  const place = resolvePlace(lat, lon, tracker?.state);

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
