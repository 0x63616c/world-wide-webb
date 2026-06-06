import { inArray } from "drizzle-orm";
import {
  assignMoodColors,
  BLUE_RGB,
  LampScene,
  RED_RGB,
  WHITE_SCENE_KELVIN,
} from "../config/lamp-scenes";
import {
  FIXTURE_ENTITY_IDS,
  findLight,
  LAMP_ENTITY_IDS,
  type LightEntry,
  LightKind,
} from "../config/lights";
import { db } from "../db/index";
import type { DeviceLightState, LightColor } from "../db/schema";
import { deviceState } from "../db/schema";
import { env } from "../env";
import { ha } from "../integrations/homeassistant";
import type { HaEntity } from "../integrations/homeassistant/types";
import { DeviceKind, mergeDeviceState } from "./device-state-mapping";

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
  /**
   * The colour scene every on-lamp currently agrees on, derived from DESIRED
   * colours (white/red/blue). null when lamps disagree, are off, or show a
   * non-scene colour (e.g. mood, which is intentionally varied). CC-7d5b.3.4
   * widens this to include "party" (overridden from the lamp_mode row).
   */
  activeScene: LampScene | null;
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

/** Convert an HA raw brightness (0..255) to a rounded 0..100 pct. */
function brightnessRawToPct(raw: number | undefined): number {
  if (typeof raw !== "number") return 0;
  return Math.round((raw / 255) * 100);
}

/** Convert a 0..100 pct to HA raw brightness (0..255), clamped. */
function brightnessPctToRaw(pct: number): number {
  const clamped = Math.min(100, Math.max(0, pct));
  return Math.round((clamped / 100) * 255);
}

/**
 * The "fan" is the AC's climate fan_mode, not a fan.* device (evee parity:
 * ha-service getFanState/turnFanOn). It lives on the CONFIGURED home thermostat
 * (env.CLIMATE_ENTITY_ID) — resolving by "first climate entity with fan_modes"
 * could match the Tesla's climate.evee_climate instead of the house AC
 * (CC-355t.15; see memory ha-evee-is-tesla-not-home-climate).
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

// ─── desired-authoritative effective state ────────────────────────────────────

/** The effective (desired-authoritative) view of one managed light. */
interface EffectiveLight {
  /** Painted-on only when reachable AND effective state is on. */
  on: boolean;
  /** Effective desired/reported state (null when no row yet). */
  state: DeviceLightState | null;
  available: boolean;
  pending: boolean;
}

/**
 * Resolve a managed light's effective state from its device_state row. Desired is
 * authoritative (mergeDeviceState); availability is honest — an unreachable light
 * is never painted "on" even if desired says so (repo ZERO-fake-data rule). A
 * device with no row yet is treated as unavailable (not painted).
 */
function effectiveLight(row: typeof deviceState.$inferSelect | undefined): EffectiveLight {
  if (!row) return { on: false, state: null, available: false, pending: false };
  const merged = mergeDeviceState(row);
  const state = (merged.state as DeviceLightState | null) ?? null;
  const on = merged.available && (state?.on ?? false);
  return { on, state, available: merged.available, pending: merged.pending };
}

// ─── activeScene derivation (from desired colours) ────────────────────────────

function rgbEquals(a: readonly number[] | undefined, b: readonly number[]): boolean {
  return !!a && a.length === 3 && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/** Map one desired colour to the scene it represents, or null. Exact compare —
 *  these are our OWN written values, so no HA round-trip tolerance is needed. */
function colorToScene(color: LightColor | undefined): LampScene | null {
  if (!color) return null;
  if (color.kelvin === WHITE_SCENE_KELVIN) return LampScene.White;
  if (rgbEquals(color.rgb, RED_RGB)) return LampScene.Red;
  if (rgbEquals(color.rgb, BLUE_RGB)) return LampScene.Blue;
  return null;
}

/**
 * Derive the active scene from the desired colours of the on-lamps. Every on-lamp
 * must agree on the same scene; otherwise null (lamps off, mixed colours, or a
 * mood/custom wash all → null). The party mode overrides this from the lamp_mode
 * row (added in CC-7d5b.3.4 via deriveActiveScene's caller).
 */
export function deriveSceneFromDesired(
  onLampStates: (DeviceLightState | null)[],
): LampScene | null {
  if (onLampStates.length === 0) return null;
  let scene: LampScene | null = null;
  for (const state of onLampStates) {
    const s = colorToScene(state?.color);
    if (s === null) return null;
    if (scene === null) scene = s;
    else if (scene !== s) return null;
  }
  return scene;
}

// ─── public API ──────────────────────────────────────────────────────────────

/**
 * Fetch the current state of all controllable entities: lamps, lights, fan.
 *
 * DESIRED-authoritative (CC-7d5b.2.4): lamp/light on/brightness/colour come from
 * the device_state DESIRED state (the source of truth the enforcer reconciles onto
 * HA), so the panel reads its own intent with no snap-back. Availability is read
 * honestly from the row — an unreachable light is never painted "on". The fan
 * stays live-from-HA (climate fan_mode), unchanged.
 *
 * Throws when HA is unconfigured or unreachable so the tile shimmers via the tRPC
 * error state (CC-355t.30; the repo-wide THROW-on-unavailable convention).
 */
export async function getControlsState(): Promise<ControlsState> {
  if (!ha.isConfigured()) {
    throw new Error("Home Assistant is not configured");
  }

  // Only the fan still reads live from HA; lamps/lights are desired-authoritative.
  let climateEntities: HaEntity[] = [];
  try {
    climateEntities = await ha.getEntities("climate");
  } catch (err) {
    throw new Error(
      `Home Assistant unreachable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const fanEntity = findFanClimate(climateEntities);

  // Lamp/light state is read from device_state (desired-authoritative).
  let deviceRows: (typeof deviceState.$inferSelect)[] = [];
  try {
    deviceRows = await db.select().from(deviceState);
  } catch {
    // DB unreachable — no rows; every managed light reads unavailable (shimmer).
  }
  const rowByEntityId = new Map(deviceRows.map((r) => [r.entityId, r]));

  const lampEffectives = LAMP_ENTITY_IDS.map((id) => effectiveLight(rowByEntityId.get(id)));
  const fixtureEffectives = FIXTURE_ENTITY_IDS.map((id) => effectiveLight(rowByEntityId.get(id)));

  const lampsOn = lampEffectives.filter((e) => e.on);
  const anyLampOn = lampsOn.length > 0;
  const avgBrightness = anyLampOn
    ? Math.round(
        lampsOn.reduce((sum, e) => sum + brightnessRawToPct(e.state?.brightness), 0) /
          lampsOn.length,
      )
    : 0;
  const lampsPending = lampEffectives.some((e) => e.pending);

  const anyLightOn = fixtureEffectives.some((e) => e.on);
  const lightsPending = fixtureEffectives.some((e) => e.pending);

  const activeScene = await resolveActiveScene(lampsOn.map((e) => e.state));

  // Fan = the climate entity's fan_mode (evee parity). Not in device_state, so
  // there is no desired overlay — read fan_mode live, no pending.
  return {
    lamps: {
      on: anyLampOn,
      count: lampsOn.length,
      brightness: avgBrightness,
      sub: anyLampOn ? "On" : "Off",
      pending: lampsPending,
      activeScene,
    },
    lights: {
      on: anyLightOn,
      pending: lightsPending,
    },
    fan: {
      on: fanModeOn(fanEntity),
      sub: fanSub(fanEntity),
      pending: false,
    },
  };
}

/**
 * Resolve the active scene. In CC-7d5b.2.4 this is just the desired-colour scene;
 * CC-7d5b.3.4 overrides it with the lamp_mode row ('party'). Kept async so the
 * party override (a DB read) slots in without reshaping callers.
 */
async function resolveActiveScene(
  onLampStates: (DeviceLightState | null)[],
): Promise<LampScene | null> {
  return deriveSceneFromDesired(onLampStates);
}

// ─── desired-state writes ──────────────────────────────────────────────────────

/**
 * Upsert the desired state for a set of managed lights, then return so the caller
 * can actuate HA. Desired is STICKY (no expiry window) — it is the source of truth
 * the enforcer continuously reconciles. `mutate` derives the new desired from the
 * existing one (so a brightness change keeps the colour, a toggle keeps the scene).
 */
async function writeDesired(
  entries: LightEntry[],
  mutate: (entry: LightEntry, prev: DeviceLightState | null) => DeviceLightState,
): Promise<Map<string, DeviceLightState>> {
  const desiredByEntity = new Map<string, DeviceLightState>();
  if (entries.length === 0) return desiredByEntity;

  let rows: (typeof deviceState.$inferSelect)[] = [];
  try {
    rows = await db
      .select()
      .from(deviceState)
      .where(
        inArray(
          deviceState.entityId,
          entries.map((e) => e.entityId),
        ),
      );
  } catch {
    rows = [];
  }
  const rowByEntityId = new Map(rows.map((r) => [r.entityId, r]));
  const now = new Date();

  await Promise.all(
    entries.map(async (entry) => {
      const prev =
        (rowByEntityId.get(entry.entityId)?.desiredState as DeviceLightState | null) ?? null;
      const desired = mutate(entry, prev);
      desiredByEntity.set(entry.entityId, desired);
      try {
        await db
          .insert(deviceState)
          .values({
            id: entry.id,
            kind: entry.kind === LightKind.Lamp ? DeviceKind.Light : DeviceKind.Switch,
            entityId: entry.entityId,
            domain: entry.domain,
            label: entry.label,
            desiredState: desired,
            desiredAtUtc: now,
            available: true,
          })
          .onConflictDoUpdate({
            target: deviceState.entityId,
            set: { desiredState: desired, desiredAtUtc: now },
          });
      } catch {
        // DB unreachable — desired cannot be written; the HA actuation still fires
        // so the command is never a silent no-op.
      }
    }),
  );
  return desiredByEntity;
}

/** All lamp LightEntry rows in LAMP_ENTITY_IDS order. */
function lampEntries(): LightEntry[] {
  return LAMP_ENTITY_IDS.map((id) => findLight(id)).filter((e): e is LightEntry => !!e);
}

/** All fixture LightEntry rows in FIXTURE_ENTITY_IDS order. */
function fixtureEntries(): LightEntry[] {
  return FIXTURE_ENTITY_IDS.map((id) => findLight(id)).filter((e): e is LightEntry => !!e);
}

/** Build a `light.turn_on` payload from a desired light state (brightness raw 0..255). */
function turnOnParams(entityId: string, desired: DeviceLightState): Record<string, unknown> {
  const params: Record<string, unknown> = { entity_id: entityId };
  if (desired.brightness != null) params.brightness = desired.brightness;
  if (desired.color?.rgb) params.rgb_color = desired.color.rgb;
  else if (desired.color?.kelvin != null) params.color_temp_kelvin = desired.color.kelvin;
  return params;
}

/** Actuate HA immediately for a desired light state (on→turn_on, off→turn_off). */
async function actuate(entry: LightEntry, desired: DeviceLightState): Promise<void> {
  if (desired.on) {
    await ha.callService(entry.domain, HaService.TurnOn, turnOnParams(entry.entityId, desired));
  } else {
    await ha.callService(entry.domain, HaService.TurnOff, { entity_id: entry.entityId });
  }
}

// ─── mutations (write desired + actuate now) ──────────────────────────────────

/**
 * Toggle lamps, lights, or fan on or off.
 *
 * For lamps/lights: writes the on/off intent to device_state DESIRED (sticky) AND
 * fires the HA actuation immediately for an instant physical response. Turning a
 * lamp ON preserves its existing desired colour/brightness (the scene survives a
 * toggle). The enforcer is the continuous safety-net that re-asserts on drift.
 * Fan stays the climate fan_mode path (evee parity). Throws when HA is
 * unconfigured. Returns the desired-authoritative state after dispatching.
 */
export async function toggleControl(key: ControlKey, on: boolean): Promise<ControlsState> {
  if (!ha.isConfigured()) {
    throw new Error("Home Assistant is not configured");
  }

  switch (key) {
    case ControlKey.Lamps: {
      const entries = lampEntries();
      // Toggle ON preserves the existing desired colour/brightness (scene survives
      // a toggle); OFF just flips on. The desired write is the source of truth.
      const desiredByEntity = await writeDesired(entries, (_entry, prev) =>
        on ? { ...prev, on: true } : { ...(prev ?? {}), on: false },
      );
      await Promise.all(
        entries.map((entry) => actuate(entry, desiredByEntity.get(entry.entityId) ?? { on })),
      );
      break;
    }

    case ControlKey.Lights: {
      const entries = fixtureEntries();
      await writeDesired(entries, () => ({ on }));
      await Promise.all(entries.map((entry) => actuate(entry, { on })));
      break;
    }

    case ControlKey.Fan: {
      // evee parity: force the configured climate's fan_mode on/auto via
      // set_fan_mode. The target entity is known from config (CC-355t.15: no
      // double climate fetch — getControlsState reads it once below).
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
 * Per-lamp desired colour for a scene. white/red/blue are uniform; mood assigns
 * each lamp a UNIQUE random palette colour (different every call). Returned in
 * LAMP_ENTITY_IDS order so it lines up with the lamp entries.
 */
function sceneColors(scene: LampScene): LightColor[] {
  if (scene === LampScene.Mood) {
    return assignMoodColors(LAMP_ENTITY_IDS.length).map((rgb) => ({
      rgb: [rgb[0], rgb[1], rgb[2]],
    }));
  }
  if (scene === LampScene.White) {
    return LAMP_ENTITY_IDS.map(() => ({ kelvin: WHITE_SCENE_KELVIN }));
  }
  const rgb = scene === LampScene.Red ? RED_RGB : BLUE_RGB;
  return LAMP_ENTITY_IDS.map(() => ({ rgb: [rgb[0], rgb[1], rgb[2]] }));
}

/**
 * Apply a colour scene to every lamp: writes the colour into device_state DESIRED
 * (on=true) AND actuates HA immediately. activeScene then reflects the scene from
 * desired. For "mood" each lamp gets a distinct random colour (so activeScene is
 * null — mood is intentionally varied). Throws when HA is unconfigured.
 */
export async function setLampScene(scene: LampScene): Promise<ControlsState> {
  if (!ha.isConfigured()) {
    throw new Error("Home Assistant is not configured");
  }

  const entries = lampEntries();
  const colors = sceneColors(scene);
  // entries are in LAMP_ENTITY_IDS order, so colors[i] lines up with entries[i].
  const colorByEntity = new Map(entries.map((entry, i) => [entry.entityId, colors[i]]));

  const desiredByEntity = await writeDesired(entries, (entry) => ({
    on: true,
    color: colorByEntity.get(entry.entityId),
  }));
  await Promise.all(
    entries.map((entry) => actuate(entry, desiredByEntity.get(entry.entityId) ?? { on: true })),
  );

  return getControlsState();
}

/**
 * Set brightness (0..100 %) on every lamp: writes brightness into device_state
 * DESIRED (on=true, preserving each lamp's existing colour) AND actuates HA. The
 * pct is clamped. Throws when HA is unconfigured.
 */
export async function setLampBrightness(pct: number): Promise<ControlsState> {
  if (!ha.isConfigured()) {
    throw new Error("Home Assistant is not configured");
  }

  const raw = brightnessPctToRaw(pct);
  const entries = lampEntries();

  const desiredByEntity = await writeDesired(entries, (_entry, prev) => ({
    on: true,
    brightness: raw,
    ...(prev?.color ? { color: prev.color } : {}),
  }));
  await Promise.all(
    entries.map((entry) =>
      actuate(entry, desiredByEntity.get(entry.entityId) ?? { on: true, brightness: raw }),
    ),
  );

  return getControlsState();
}
