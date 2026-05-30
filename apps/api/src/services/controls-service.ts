import { inArray } from "drizzle-orm";

import { LIGHTS } from "../config/lights";
import { db } from "../db/index";
import { deviceState } from "../db/schema";
import { ha } from "../integrations/homeassistant";
import type { HaEntity } from "../integrations/homeassistant/types";
import { commandDevice } from "./device-command-service";
import { mergeDeviceState } from "./device-sync-service";

// ─── types ───────────────────────────────────────────────────────────────────

export interface LampState {
  on: boolean;
  /** Number of lamp entities currently on. */
  count: number;
  /** Sub-label, e.g. "2 on · warm". */
  sub: string;
  pending: boolean;
}

export interface LightState {
  on: boolean;
  pending: boolean;
}

export interface FanState {
  on: boolean;
  /** Sub-label, e.g. "Medium". */
  sub: string;
  pending: boolean;
}

export interface ControlsState {
  lamps: LampState;
  lights: LightState;
  fan: FanState;
}

export type ControlKey = "lamps" | "lights" | "fan";

// ─── helpers ─────────────────────────────────────────────────────────────────

/** True when an HA entity state string represents "on". */
function isOn(entity: HaEntity): boolean {
  return entity.state === "on";
}

/**
 * Colour-temperature attribute → human label.
 * HA reports color_temp_kelvin (or color_temp in mireds); we produce a simple
 * warm / neutral / cool label.
 */
function warmthLabel(entity: HaEntity): string {
  const kelvin = entity.attributes.color_temp_kelvin as number | undefined;
  if (kelvin === undefined) return "";
  if (kelvin <= 3000) return "warm";
  if (kelvin <= 4500) return "neutral";
  return "cool";
}

function lampSub(entities: HaEntity[]): string {
  const onEntities = entities.filter(isOn);
  const n = onEntities.length;
  if (n === 0) return "all off";
  const warmth = onEntities.map(warmthLabel).find(Boolean) ?? "";
  return warmth ? `${n} on · ${warmth}` : `${n} on`;
}

/**
 * The "fan" is the AC's climate fan_mode, not a fan.* device (evee parity:
 * ha-service getFanState/turnFanOn). We pick the first climate entity that
 * advertises a fan_modes list and treat fan_mode === "on" as forced-on.
 */
function findFanClimate(climateEntities: HaEntity[]): HaEntity | undefined {
  return climateEntities.find((e) => Array.isArray(e.attributes.fan_modes));
}

function fanModeOn(entity: HaEntity | undefined): boolean {
  return (entity?.attributes.fan_mode as string | undefined) === "on";
}

function fanSub(entity: HaEntity | undefined): string {
  return fanModeOn(entity) ? "On" : "";
}

// ─── config-driven entity resolution ─────────────────────────────────────────

/**
 * Resolve lamp and fixture entities from fetched HA entities using the explicit
 * LIGHTS config. Lamps = Hue light.* kind; fixtures = switch.* kind.
 *
 * Only entities listed in config are included — no substring guessing.
 */
function resolveEntities(
  lightEntities: HaEntity[],
  switchEntities: HaEntity[],
): { lamps: HaEntity[]; lights: HaEntity[] } {
  const lampEntityIds = new Set(LIGHTS.filter((l) => l.kind === "lamp").map((l) => l.entityId));
  const fixtureEntityIds = new Set(
    LIGHTS.filter((l) => l.kind === "fixture").map((l) => l.entityId),
  );

  const lamps = lightEntities.filter((e) => lampEntityIds.has(e.entity_id));
  const lights = switchEntities.filter((e) => fixtureEntityIds.has(e.entity_id));

  return { lamps, lights };
}

// ─── public API ──────────────────────────────────────────────────────────────

/**
 * Fetch current merged state of all controllable entities: lamps, lights, fan.
 *
 * Returns null when HA is unconfigured or unreachable so the tile renders
 * shimmer (CC-nra rule: no fake data).
 *
 * For any device that has an active desired window, the merged state reflects
 * the desired value with pending=true.
 */
export async function getControlsState(): Promise<ControlsState | null> {
  if (!ha.isConfigured()) {
    return null;
  }

  let lightEntities: HaEntity[] = [];
  let switchEntities: HaEntity[] = [];
  let climateEntities: HaEntity[] = [];

  try {
    [lightEntities, switchEntities, climateEntities] = await Promise.all([
      ha.getEntities("light"),
      ha.getEntities("switch"),
      ha.getEntities("climate"),
    ]);
  } catch {
    return null;
  }

  const { lamps, lights } = resolveEntities(lightEntities, switchEntities);
  const fanEntity = findFanClimate(climateEntities);

  // Fetch device rows and build a lookup by entityId for overlay merge.
  let deviceRows: (typeof deviceState.$inferSelect)[] = [];
  try {
    deviceRows = await db.select().from(deviceState);
  } catch {
    // DB unreachable — fall through with empty rows (no overlay applied).
  }

  const now = new Date();
  const deviceByEntityId = new Map(deviceRows.map((r) => [r.entityId, r]));

  // Compute per-group pending: if ANY device in the group has an active overlay, the group is pending.
  function isPending(entities: HaEntity[]): boolean {
    return entities.some((e) => {
      const row = deviceByEntityId.get(e.entity_id);
      if (!row) return false;
      return mergeDeviceState(row, now).pending;
    });
  }

  function mergedOn(entity: HaEntity | undefined): boolean {
    if (!entity) return false;
    const row = deviceByEntityId.get(entity.entity_id);
    if (!row) return isOn(entity);
    const merged = mergeDeviceState(row, now);
    return merged.state?.on ?? isOn(entity);
  }

  const lampsOn = lamps.filter((e) => mergedOn(e));
  const anyLightOn = lights.some((e) => mergedOn(e));

  // Fan = the climate entity's fan_mode (evee parity). It is not in the lights
  // device_state registry, so there is no overlay/pending — read fan_mode live.
  const fanOn = fanModeOn(fanEntity);
  const fanPending = false;

  return {
    lamps: {
      on: lampsOn.length > 0,
      count: lampsOn.length,
      sub: lampSub(lamps),
      pending: isPending(lamps),
    },
    lights: {
      on: anyLightOn,
      pending: isPending(lights),
    },
    fan: {
      on: fanOn,
      sub: fanSub(fanEntity),
      pending: fanPending,
    },
  };
}

/**
 * Dispatch an on/off command to HA for each entity, applying the optimistic
 * overlay where possible.
 *
 * Registered devices (a matching device_state row) go through commandDevice,
 * which writes desiredState for anti-flicker AND dispatches to HA. Unregistered
 * entities have no DB row so no overlay is possible, but the command MUST still
 * reach HA — we call the service directly. Without this direct path an empty
 * device_state table makes every toggle a silent no-op.
 */
async function dispatchControls(entityIds: string[], on: boolean): Promise<void> {
  if (entityIds.length === 0) return;

  let rows: (typeof deviceState.$inferSelect)[] = [];
  try {
    rows = await db.select().from(deviceState).where(inArray(deviceState.entityId, entityIds));
  } catch {
    // DB unreachable — no overlay, but commands still go to HA below.
    rows = [];
  }
  const rowByEntityId = new Map(rows.map((r) => [r.entityId, r]));

  await Promise.all(
    entityIds.map((entityId) => {
      const row = rowByEntityId.get(entityId);
      if (row) {
        return commandDevice({ id: row.id, action: "setOn", args: { on } });
      }
      const domain = entityId.split(".")[0];
      return ha.callService(domain, on ? "turn_on" : "turn_off", { entity_id: entityId });
    }),
  );
}

/**
 * Toggle lamps, lights, or fan on or off.
 *
 * Uses the explicit LIGHTS config to identify entity ids and domains.
 * Writes an optimistic overlay to the DB before dispatching to HA so that
 * subsequent getControlsState calls reflect the desired value immediately
 * (no flicker while HA catches up).
 * Throws when HA is unconfigured (caller should surface a tRPC error).
 * Returns merged state after dispatching the command.
 */
export async function toggleControl(key: ControlKey, on: boolean): Promise<ControlsState | null> {
  if (!ha.isConfigured()) {
    throw new Error("Home Assistant is not configured");
  }

  switch (key) {
    case "lamps": {
      const lampEntries = LIGHTS.filter((l) => l.kind === "lamp");
      if (lampEntries.length > 0) {
        await dispatchControls(
          lampEntries.map((l) => l.entityId),
          on,
        );
      }
      break;
    }

    case "lights": {
      const fixtureEntries = LIGHTS.filter((l) => l.kind === "fixture");
      if (fixtureEntries.length > 0) {
        await dispatchControls(
          fixtureEntries.map((l) => l.entityId),
          on,
        );
      }
      break;
    }

    case "fan": {
      // evee parity: force the climate fan_mode on/auto via set_fan_mode.
      const fanEntity = findFanClimate(await ha.getEntities("climate"));
      if (fanEntity) {
        await ha.callService("climate", "set_fan_mode", {
          entity_id: fanEntity.entity_id,
          fan_mode: on ? "on" : "auto",
        });
      }
      break;
    }
  }

  return getControlsState();
}
