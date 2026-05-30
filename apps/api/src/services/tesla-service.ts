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

/** Placeholder used when HA is unconfigured or the car is asleep/unavailable. */
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

export async function getTeslaData(): Promise<TeslaData> {
  if (!ha.isConfigured()) return TESLA_PLACEHOLDER;

  const ids = teslaEntityIds();
  let map: Record<string, HaEntity>;
  try {
    const keys = Object.keys(ids) as (keyof typeof ids)[];
    const results = await Promise.allSettled(keys.map((k) => ha.getEntity(ids[k])));
    map = {};
    results.forEach((r, i) => {
      if (r.status === "fulfilled" && r.value) map[keys[i]] = r.value;
    });
  } catch {
    return TESLA_PLACEHOLDER;
  }

  // If we couldn't read even the battery, treat the whole car as unavailable.
  if (!map.battery || DEAD_STATES.has(map.battery.state)) return TESLA_PLACEHOLDER;

  const pct = Math.round(num(map.battery, TESLA_PLACEHOLDER.pct));
  // `sensor.<car>_charging` is an enum: starting | charging | stopped | complete | disconnected | no_power
  const chargeState = map.charging?.state ?? "";
  const charging = chargeState === "charging" || chargeState === "starting";
  const rate = num(map.rate, TESLA_PLACEHOLDER.rate);
  const range = Math.round(num(map.range, TESLA_PLACEHOLDER.range));
  const climate = Math.round(num(map.cabin, TESLA_PLACEHOLDER.climate));

  // Odometer is frequently disabled in the integration — fall back gracefully.
  const odo = map.odometer
    ? Math.round(num(map.odometer, 0)).toLocaleString("en-US")
    : TESLA_PLACEHOLDER.odo;

  const locked = map.lock ? map.lock.state === "locked" : TESLA_PLACEHOLDER.locked;

  const tracker = map.tracker;
  const latAttr = tracker ? Number(tracker.attributes.latitude) : Number.NaN;
  const lonAttr = tracker ? Number(tracker.attributes.longitude) : Number.NaN;
  const lat = Number.isFinite(latAttr) ? latAttr : null;
  const lon = Number.isFinite(lonAttr) ? lonAttr : null;
  // device_tracker state is a zone name ("home", "work", ...) — map home to the label.
  const place =
    !tracker || tracker.state === "home" ? env.LOCATION_LABEL : titleCase(String(tracker.state));

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
