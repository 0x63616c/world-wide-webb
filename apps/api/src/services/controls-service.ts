import { inArray } from "drizzle-orm";
import {
  assignMoodColors,
  BLUE_RGB,
  LampScene,
  RED_RGB,
  WHITE_SCENE_KELVIN,
} from "../config/lamp-scenes";
import { findLight, LAMP_ENTITY_IDS, LIGHTS, LightKind } from "../config/lights";
import { db } from "../db/index";
import { deviceState } from "../db/schema";
import { env } from "../env";
import { ha } from "../integrations/homeassistant";
import type { HaEntity } from "../integrations/homeassistant/types";
import { commandDevice, DeviceAction } from "./device-command-service";
import { DeviceKind } from "./device-state-mapping";
import { mergeDeviceState } from "./device-sync-service";

const DESIRED_WINDOW_MS = 5_000;

// ─── types ───────────────────────────────────────────────────────────────────

export interface LampState {
  on: boolean;
  /** Number of lamp entities currently on. */
  count: number;
  /** Average brightness (0..100, rounded) across on-lamps; 0 when none on. */
  brightness: number;
  /** Sub-label. Always "On" or "Off" — no count or warmth. */
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

export const ControlKey = {
  Lamps: "lamps",
  Lights: "lights",
  Fan: "fan",
} as const;
export type ControlKey = (typeof ControlKey)[keyof typeof ControlKey];

export const FanMode = {
  On: "on",
  Auto: "auto",
} as const;
export type FanMode = (typeof FanMode)[keyof typeof FanMode];

export const HaService = {
  TurnOn: "turn_on",
  TurnOff: "turn_off",
  SetFanMode: "set_fan_mode",
} as const;
export type HaService = (typeof HaService)[keyof typeof HaService];

// ─── helpers ─────────────────────────────────────────────────────────────────

/** True when an HA entity state string represents "on". */
function isOn(entity: HaEntity): boolean {
  return entity.state === "on";
}

/**
 * Convert an HA light's `attributes.brightness` (0..255) to a 0..100 pct.
 * Returns 0 when the attribute is absent/non-numeric (lamp off or no dimmer).
 */
function brightnessPct(entity: HaEntity): number {
  const raw = entity.attributes.brightness;
  if (typeof raw !== "number") return 0;
  return Math.round((raw / 255) * 100);
}

/**
 * The "fan" is the AC's climate fan_mode, not a fan.* device (evee parity:
 * ha-service getFanState/turnFanOn). It lives on the CONFIGURED home thermostat
 * (env.CLIMATE_ENTITY_ID) — resolving by "first climate entity with fan_modes"
 * could match the Tesla's climate.evee_climate instead of the house AC
 * (www-355t.15; see memory ha-evee-is-tesla-not-home-climate).
 */
function findFanClimate(climateEntities: HaEntity[]): HaEntity | undefined {
  return climateEntities.find(
    (e) => e.entity_id === env.CLIMATE_ENTITY_ID && Array.isArray(e.attributes.fan_modes),
  );
}

function fanModeOn(entity: HaEntity | undefined): boolean {
  return (entity?.attributes.fan_mode as string | undefined) === FanMode.On;
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
  const lampEntityIds = new Set(
    LIGHTS.filter((l) => l.kind === LightKind.Lamp).map((l) => l.entityId),
  );
  const fixtureEntityIds = new Set(
    LIGHTS.filter((l) => l.kind === LightKind.Fixture).map((l) => l.entityId),
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
 * shimmer (www-nra rule: no fake data).
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

  const anyLampOn = lampsOn.length > 0;
  // Average brightness across on-lamps only (off lamps excluded); 0 when none on.
  const avgBrightness = anyLampOn
    ? Math.round(lampsOn.reduce((sum, e) => sum + brightnessPct(e), 0) / lampsOn.length)
    : 0;
  return {
    lamps: {
      on: anyLampOn,
      count: lampsOn.length,
      brightness: avgBrightness,
      sub: anyLampOn ? "On" : "Off",
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
 * Dispatch an on/off command to HA for each entity, writing a desired-window
 * overlay for every entity regardless of whether it is pre-seeded in device_state.
 *
 * Registered devices go through commandDevice (writes overlay + dispatches).
 * Unregistered devices are upserted into device_state with the desired overlay
 * first, then dispatched to HA directly. The upsert guarantees that subsequent
 * getControlsState calls see the desired value during the cooldown window and
 * never snap back to stale HA state.
 */
async function dispatchControls(entityIds: string[], on: boolean): Promise<void> {
  if (entityIds.length === 0) return;

  let rows: (typeof deviceState.$inferSelect)[] = [];
  try {
    rows = await db.select().from(deviceState).where(inArray(deviceState.entityId, entityIds));
  } catch {
    rows = [];
  }
  const rowByEntityId = new Map(rows.map((r) => [r.entityId, r]));

  await Promise.all(
    entityIds.map(async (entityId) => {
      const row = rowByEntityId.get(entityId);
      if (row) {
        return commandDevice({ id: row.id, action: DeviceAction.SetOn, args: { on } });
      }

      // Auto-register with a desired-window overlay so getControlsState holds
      // the optimistic value during the 5 s window even though this entity was
      // not pre-seeded in device_state.
      const entry = findLight(entityId);
      if (entry) {
        const now = new Date();
        const desiredUntil = new Date(now.getTime() + DESIRED_WINDOW_MS);
        try {
          await db
            .insert(deviceState)
            .values({
              id: entry.id,
              kind: entry.kind === LightKind.Lamp ? DeviceKind.Light : DeviceKind.Switch,
              entityId: entry.entityId,
              domain: entry.domain,
              label: entry.label,
              desiredState: { on },
              desiredAtUtc: now,
              desiredUntilUtc: desiredUntil,
              available: true,
            })
            .onConflictDoUpdate({
              target: deviceState.entityId,
              set: {
                desiredState: { on },
                desiredAtUtc: now,
                desiredUntilUtc: desiredUntil,
              },
            });
        } catch {
          // DB unreachable — overlay cannot be written; command still reaches HA.
        }
      }

      const domain = entityId.split(".")[0];
      return ha.callService(domain, on ? HaService.TurnOn : HaService.TurnOff, {
        entity_id: entityId,
      });
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
    case ControlKey.Lamps: {
      const lampEntries = LIGHTS.filter((l) => l.kind === LightKind.Lamp);
      if (lampEntries.length > 0) {
        await dispatchControls(
          lampEntries.map((l) => l.entityId),
          on,
        );
      }
      break;
    }

    case ControlKey.Lights: {
      const fixtureEntries = LIGHTS.filter((l) => l.kind === LightKind.Fixture);
      if (fixtureEntries.length > 0) {
        await dispatchControls(
          fixtureEntries.map((l) => l.entityId),
          on,
        );
      }
      break;
    }

    case ControlKey.Fan: {
      // evee parity: force the configured climate's fan_mode on/auto via
      // set_fan_mode. The target entity is known from config, so there's no
      // climate fetch here — getControlsState() below reads HA once for the
      // merged result (www-355t.15: was double-fetching climate entities).
      await ha.callService("climate", HaService.SetFanMode, {
        entity_id: env.CLIMATE_ENTITY_ID,
        fan_mode: on ? FanMode.On : FanMode.Auto,
      });
      break;
    }
  }

  return getControlsState();
}

/**
 * Build the `light.turn_on` params for each lamp under a scene.
 *
 * white/red/blue are uniform across lamps. mood assigns each lamp a UNIQUE
 * colour drawn randomly from the palette (different every call), so the params
 * differ per lamp only for mood. Returned in LAMP_ENTITY_IDS order.
 */
function sceneParamsForLamps(scene: LampScene): Record<string, unknown>[] {
  if (scene === LampScene.Mood) {
    const colors = assignMoodColors(LAMP_ENTITY_IDS.length);
    return LAMP_ENTITY_IDS.map((entityId, i) => ({ entity_id: entityId, rgb_color: colors[i] }));
  }

  const uniform: Record<string, unknown> =
    scene === LampScene.White
      ? { color_temp_kelvin: WHITE_SCENE_KELVIN }
      : { rgb_color: scene === LampScene.Red ? RED_RGB : BLUE_RGB };

  return LAMP_ENTITY_IDS.map((entityId) => ({ entity_id: entityId, ...uniform }));
}

/**
 * Apply a colour scene to every lamp (Hue light.* entities).
 *
 * Dispatches one `light.turn_on` per lamp with the scene's colour args. For
 * "mood" each lamp gets a distinct, randomly-assigned palette colour; the
 * others are uniform. Throws when HA is unconfigured (caller surfaces a tRPC
 * error). Returns the merged controls state after dispatching, mirroring
 * toggleControl.
 */
export async function setLampScene(scene: LampScene): Promise<ControlsState | null> {
  if (!ha.isConfigured()) {
    throw new Error("Home Assistant is not configured");
  }

  await Promise.all(
    sceneParamsForLamps(scene).map((params) => ha.callService("light", HaService.TurnOn, params)),
  );

  return getControlsState();
}

/**
 * Set brightness (0..100 %) on every lamp via `light.turn_on` + brightness_pct.
 *
 * The percentage is clamped to the valid range. Throws when HA is unconfigured.
 * Returns the merged controls state after dispatching.
 */
export async function setLampBrightness(pct: number): Promise<ControlsState | null> {
  if (!ha.isConfigured()) {
    throw new Error("Home Assistant is not configured");
  }

  const clamped = Math.min(100, Math.max(0, Math.round(pct)));

  await Promise.all(
    LAMP_ENTITY_IDS.map((entityId) =>
      ha.callService("light", HaService.TurnOn, {
        entity_id: entityId,
        brightness_pct: clamped,
      }),
    ),
  );

  return getControlsState();
}
