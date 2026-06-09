import { getLogger } from "@repo/logger";
import { eq, inArray } from "drizzle-orm";
import {
  assignMoodColors,
  BLUE_RGB,
  LampMode,
  type LampModeSpeed,
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
import type { DeviceClimateState, DeviceLightState, LightColor } from "../db/schema";
import { deviceState, LAMP_MODE_SINGLETON_ID, lampMode } from "../db/schema";
import { ha } from "../integrations/homeassistant";
import { CLIMATE_DEVICE_ID } from "./climate-enforcer-service";
import { DeviceKind, isClimateState, mergeDeviceState } from "./device-state-mapping";

// ─── types ───────────────────────────────────────────────────────────────────

interface LampState {
  on: boolean;
  /** Number of lamp entities currently on. */
  count: number;
  /** Average brightness (0..100, rounded) across on-lamps; 0 when none on. */
  brightness: number;
  /** Sub-label. Always "On" or "Off" — no count or warmth. */
  sub: string;
  pending: boolean;
  /**
   * The active lamp scene. "party" (and any future animated mode) when the
   * lamp_mode row is set; otherwise the colour scene every on-lamp agrees on,
   * derived from DESIRED colours (white/red/blue). null when no mode is set and
   * lamps disagree, are off, or show a non-scene colour (e.g. mood, which is
   * intentionally varied) (CC-7d5b.3.4).
   */
  activeScene: ActiveScene | null;
}

/**
 * The active lamp scene reported to the UI: one of the colour scenes, or an
 * animated lamp mode (currently just "party"). Never "none" — that maps to
 * "no mode set", which falls through to the colour-derived scene or null.
 */
type ActiveScene = LampScene | typeof LampMode.Party;

interface LightState {
  on: boolean;
  pending: boolean;
}

interface FanState {
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

// The app-command window (CC-unxz.1). A control mutation writes desired and
// returns WITHOUT actuating HA — the enforcer pushes desired→HA. While
// `now < desiredUntilUtc` the enforcer pushes regardless of control policy, so a
// freshly-set desired is honoured even on an `adopt` wall-switch fixture (which
// would otherwise revert it on the next cycle). The enforcer runs ~1s; 10s covers
// slow HA round-trips so the desired is pushed before the window lapses.
const COMMAND_WINDOW_MS = 10_000;

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
 * The "fan" is the AC's climate fan_mode, not a fan.* device (evee parity). It is
 * desired-authoritative now (CC-unxz.2): the dashboard writes desired.fanMode on
 * the climate device_state row and the climate enforcer pushes it to HA. So the
 * fan is read from the climate row's desired (with reported as the convergence
 * base for `pending`), exactly like the lamps/lights — NO live HA fan read.
 */
interface FanEffective {
  on: boolean;
  sub: string;
  pending: boolean;
}

/** Derive the fan view from the climate device_state row (desired-authoritative). */
function effectiveFan(row: typeof deviceState.$inferSelect | undefined): FanEffective {
  if (!row) return { on: false, sub: "", pending: false };
  const merged = mergeDeviceState(row);
  const state = isClimateState(merged.state) ? merged.state : null;
  const fanMode = state?.fanMode ?? null;
  const on = fanMode === FanMode.On;
  // Label (CC-pu4m): "On" for continuous circulation; otherwise "auto" only means
  // something while the AC is running — when the AC mode is off the fan is doing
  // nothing, so surface it honestly as "Off" rather than "Auto".
  let sub = "";
  if (on) sub = "On";
  else if (state?.mode === "off") sub = "Off";
  else if (fanMode === FanMode.Auto) sub = "Auto";
  // pending is true only while the SPECIFIED desired fanMode hasn't converged with
  // reported. An absent desired fanMode means no fan intent → never pending.
  const desired = isClimateState(row.desiredState) ? row.desiredState : null;
  const reported = isClimateState(row.reportedState) ? row.reportedState : null;
  const pending = desired?.fanMode != null && (reported?.fanMode ?? null) !== desired.fanMode;
  return { on, sub, pending };
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
function deriveSceneFromDesired(onLampStates: (DeviceLightState | null)[]): LampScene | null {
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
 * DESIRED-authoritative (CC-7d5b.2.4, CC-unxz.2): lamp/light/fan state all come
 * from the device_state DESIRED state (the source of truth the enforcers reconcile
 * onto HA), so the panel reads its own intent with no snap-back. The fan is the
 * climate row's desired.fanMode (no live HA read). Availability is read honestly
 * from the row — an unreachable light is never painted "on".
 *
 * Throws when HA is unconfigured so the tile shimmers via the tRPC error state
 * (CC-355t.30; the repo-wide THROW-on-unavailable convention).
 */
export async function getControlsState(): Promise<ControlsState> {
  if (!ha.isConfigured()) {
    throw new Error("Home Assistant is not configured");
  }

  // Lamp/light/fan state is all read from device_state (desired-authoritative).
  let deviceRows: (typeof deviceState.$inferSelect)[] = [];
  try {
    deviceRows = await db.select().from(deviceState);
  } catch (err) {
    // DB unreachable — no rows; every managed device reads unavailable (shimmer).
    getLogger().warn({ err }, "getControlsState: DB read failed, devices appear unavailable");
  }
  const rowByEntityId = new Map(deviceRows.map((r) => [r.entityId, r]));
  const rowById = new Map(deviceRows.map((r) => [r.id, r]));

  const lampEffectives = LAMP_ENTITY_IDS.map((id) => effectiveLight(rowByEntityId.get(id)));
  const fixtureEffectives = FIXTURE_ENTITY_IDS.map((id) => effectiveLight(rowByEntityId.get(id)));

  const lampsOn = lampEffectives.filter((e) => e.on);
  const anyLampOn = lampsOn.length > 0;
  // Brightness drives the modal's level bar. When lamps are ON it is the avg live
  // level of the on-lamps. When ALL lamps are OFF we report the avg last-known
  // DESIRED level (which persists across a toggle) so the bar keeps its fill and
  // the frontend greys it out, instead of dropping to 0% (CC-91bl). Only a truly
  // unknown level (no lamp has any brightness) falls back to 0 (an empty bar).
  const brightnessSource = anyLampOn
    ? lampsOn
    : lampEffectives.filter((e) => typeof e.state?.brightness === "number");
  const avgBrightness =
    brightnessSource.length > 0
      ? Math.round(
          brightnessSource.reduce((sum, e) => sum + brightnessRawToPct(e.state?.brightness), 0) /
            brightnessSource.length,
        )
      : 0;

  const anyLightOn = fixtureEffectives.some((e) => e.on);

  const activeScene = await resolveActiveScene(lampsOn.map((e) => e.state));

  // Fan = the climate row's desired.fanMode (CC-unxz.2), desired-authoritative
  // with a real `pending` from desired-vs-reported convergence.
  const fan = effectiveFan(rowById.get(CLIMATE_DEVICE_ID));

  return {
    lamps: {
      on: anyLampOn,
      count: lampsOn.length,
      brightness: avgBrightness,
      sub: anyLampOn ? "On" : "Off",
      // Lamps are desired-authoritative and NEVER report pending (CC-uq58). The
      // panel already paints desired instantly, and the Hue rgb/kelvin reported
      // rarely converges to desired within tolerance (CC-bujt.7), so a real
      // pending flag would stick on forever as a stuck dim. Only the fan keeps a
      // pending cue (a genuine HA fan_mode convergence).
      pending: false,
      activeScene,
    },
    lights: {
      on: anyLightOn,
      // Desired-authoritative, never pending — same rationale as lamps (CC-uq58).
      pending: false,
    },
    fan,
  };
}

/**
 * Resolve the active scene. The persistent lamp_mode row wins: a non-"none" mode
 * (e.g. "party") is reported directly — the animation is owned by the worker, so
 * the API can't read it from memory and must take it from the DB row (CC-7d5b.3.4).
 * Otherwise it falls back to the colour scene the on-lamps' desired colours agree
 * on (CC-7d5b.2.4).
 */
async function resolveActiveScene(
  onLampStates: (DeviceLightState | null)[],
): Promise<ActiveScene | null> {
  const mode = await readLampMode();
  if (mode !== LampMode.None) return mode;
  return deriveSceneFromDesired(onLampStates);
}

/**
 * Clear any persistent lamp mode (upsert the singleton row to "none"). The party
 * worker OWNS the colour dimension while mode=party (the enforcer yields colour to
 * it), so an explicit manual colour/scene command must end party — otherwise the
 * animation keeps overwriting the user's colour every tick and the scene never
 * sticks. Turning the lamps OFF clears it too, so party never silently resurrects
 * on the next lamp-on (CC-hu8p). DB-unreachable is swallowed: the scene/toggle
 * actuation still fires, so the command is never a silent no-op.
 */
async function clearLampMode(): Promise<void> {
  const now = new Date();
  try {
    await db
      .insert(lampMode)
      .values({ id: LAMP_MODE_SINGLETON_ID, mode: LampMode.None, speed: null, updatedAtUtc: now })
      .onConflictDoUpdate({
        target: lampMode.id,
        set: { mode: LampMode.None, speed: null, updatedAtUtc: now },
      });
  } catch {
    // DB unreachable — mode can't be cleared; the actuation below still fires.
  }
}

/** Read the persistent lamp_mode (the singleton row); "none" when absent/unreadable. */
async function readLampMode(): Promise<LampMode> {
  try {
    const rows = await db
      .select({ mode: lampMode.mode })
      .from(lampMode)
      .where(eq(lampMode.id, LAMP_MODE_SINGLETON_ID))
      .limit(1);
    const mode = rows[0]?.mode;
    return mode === LampMode.Party ? LampMode.Party : LampMode.None;
  } catch {
    return LampMode.None;
  }
}

// ─── desired-state writes ──────────────────────────────────────────────────────

/**
 * Upsert the desired state for a set of managed lights. Desired is STICKY (no
 * expiry) — it is the source of truth the enforcer continuously reconciles.
 * `mutate` derives the new desired from the existing one (so a brightness change
 * keeps the colour, a toggle keeps the scene).
 *
 * Each write also stamps a short `desiredUntilUtc` COMMAND WINDOW (CC-unxz.1):
 * the mutations no longer actuate HA themselves, so the enforcer must PUSH this
 * freshly-set desired regardless of control policy until it converges or the
 * window expires. Without it an `adopt` fixture (a wall-switch) would revert a
 * just-issued tap on the very next enforcer cycle. After the window, `control`
 * governs unsolicited drift as before.
 */
async function writeDesired(
  entries: LightEntry[],
  mutate: (entry: LightEntry, prev: DeviceLightState | null) => DeviceLightState,
): Promise<void> {
  if (entries.length === 0) return;

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
  const desiredUntil = new Date(now.getTime() + COMMAND_WINDOW_MS);

  await Promise.all(
    entries.map(async (entry) => {
      const prev =
        (rowByEntityId.get(entry.entityId)?.desiredState as DeviceLightState | null) ?? null;
      const desired = mutate(entry, prev);
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
            desiredUntilUtc: desiredUntil,
            available: true,
          })
          .onConflictDoUpdate({
            target: deviceState.entityId,
            set: { desiredState: desired, desiredAtUtc: now, desiredUntilUtc: desiredUntil },
          });
      } catch (writeErr) {
        // DB unreachable — desired cannot be written; the enforcer will re-seed
        // from reported next cycle, so the command is never a silent corruption.
        getLogger().warn(
          { err: writeErr, entityId: entry.entityId },
          "writeDesired: DB write failed",
        );
      }
    }),
  );
}

/**
 * Write the fan_mode intent onto the climate row's DESIRED (+ command window),
 * preserving the existing mode/setpoints (CC-unxz.2). The climate enforcer pushes
 * the new desired to HA — no ha.callService here. A DB-unreachable write or a
 * not-yet-seeded climate row is swallowed: the enforcer re-seeds next cycle, so
 * the command is never a silent corruption.
 */
async function writeFanDesired(fanMode: FanMode): Promise<void> {
  const now = new Date();
  const desiredUntil = new Date(now.getTime() + COMMAND_WINDOW_MS);
  try {
    const rows = await db
      .select()
      .from(deviceState)
      .where(eq(deviceState.id, CLIMATE_DEVICE_ID))
      .limit(1);
    const row = rows[0];
    if (!row) return; // enforcer hasn't seeded the thermostat yet — nothing to set.
    const prev = isClimateState(row.desiredState) ? row.desiredState : null;
    const reported = isClimateState(row.reportedState) ? row.reportedState : null;
    const base: DeviceClimateState = prev ?? reported ?? { mode: "off" };
    const desired: DeviceClimateState = { ...base, fanMode };
    await db
      .update(deviceState)
      .set({ desiredState: desired, desiredAtUtc: now, desiredUntilUtc: desiredUntil })
      .where(eq(deviceState.id, row.id));
  } catch {
    // DB unreachable — desired cannot be written; the enforcer re-seeds next cycle.
  }
}

/** All lamp LightEntry rows in LAMP_ENTITY_IDS order. */
function lampEntries(): LightEntry[] {
  return LAMP_ENTITY_IDS.map((id) => findLight(id)).filter((e): e is LightEntry => !!e);
}

/** All fixture LightEntry rows in FIXTURE_ENTITY_IDS order. */
function fixtureEntries(): LightEntry[] {
  return FIXTURE_ENTITY_IDS.map((id) => findLight(id)).filter((e): e is LightEntry => !!e);
}

// ─── mutations (write desired; the enforcer actuates HA) ──────────────────────

/**
 * Toggle lamps, lights, or fan on or off.
 *
 * For lamps/lights: writes the on/off intent to device_state DESIRED (+ a command
 * window) and returns — it does NOT actuate HA in the hot path. The light enforcer
 * pushes desired→HA within its ~1s cycle (it pushes regardless of policy while the
 * command window is open, so even an `adopt` wall-switch honours the tap). Turning
 * a lamp ON preserves its existing desired colour/brightness (the scene survives a
 * toggle). Fan stays the climate fan_mode path (evee parity). Throws when HA is
 * unconfigured. Returns the desired-authoritative state.
 */
export async function toggleControl(key: ControlKey, on: boolean): Promise<ControlsState> {
  if (!ha.isConfigured()) {
    throw new Error("Home Assistant is not configured");
  }

  switch (key) {
    case ControlKey.Lamps: {
      // Turning the lamps OFF ends party — otherwise the row persists and party
      // silently resurrects on the next lamp-on (CC-hu8p). ON leaves the mode
      // intact so a durable party re-arms when the lamps come back.
      if (!on) await clearLampMode();
      const entries = lampEntries();
      // Toggle ON preserves the existing desired colour/brightness (scene survives
      // a toggle); OFF just flips on. The desired write is the source of truth; the
      // enforcer pushes it to HA within the command window.
      await writeDesired(entries, (_entry, prev) =>
        on ? { ...prev, on: true } : { ...(prev ?? {}), on: false },
      );
      break;
    }

    case ControlKey.Lights: {
      const entries = fixtureEntries();
      await writeDesired(entries, () => ({ on }));
      break;
    }

    case ControlKey.Fan: {
      // Desired-authoritative (CC-unxz.2): write the fan_mode intent onto the
      // climate row's desired (+ command window); the climate enforcer pushes it
      // to HA. No ha.callService in the hot path.
      await writeFanDesired(on ? FanMode.On : FanMode.Auto);
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

  // A manual scene is an explicit colour intent — end party so its worker stops
  // overwriting the scene's colour every animation tick (CC-hu8p).
  await clearLampMode();

  const entries = lampEntries();
  const colors = sceneColors(scene);
  // entries are in LAMP_ENTITY_IDS order, so colors[i] lines up with entries[i].
  const colorByEntity = new Map(entries.map((entry, i) => [entry.entityId, colors[i]]));

  await writeDesired(entries, (entry) => ({
    on: true,
    color: colorByEntity.get(entry.entityId),
  }));

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

  await writeDesired(entries, (_entry, prev) => ({
    on: true,
    brightness: raw,
    ...(prev?.color ? { color: prev.color } : {}),
  }));

  return getControlsState();
}

/**
 * Set the persistent lamp mode (CC-7d5b.3.4). Writes the lamp_mode singleton row
 * ({ mode, speed }); the party WORKER reconciles that row (start/stop the colour
 * animation), so this only records intent — it does NOT drive HA itself. Starting
 * party with NO lamps currently on is a no-op (nothing to animate; the row stays
 * "none"). Throws when HA is unconfigured (parity with the other mutations, so the
 * tile surfaces the same error). Returns the desired-authoritative state.
 */
export async function setLampMode(mode: LampMode, speed?: LampModeSpeed): Promise<ControlsState> {
  if (!ha.isConfigured()) {
    throw new Error("Home Assistant is not configured");
  }

  // Starting party with no lamps on has nothing to animate — leave the row as-is.
  if (mode === LampMode.Party && !(await anyLampCurrentlyOn())) {
    return getControlsState();
  }

  const now = new Date();
  try {
    await db
      .insert(lampMode)
      .values({ id: LAMP_MODE_SINGLETON_ID, mode, speed: speed ?? null, updatedAtUtc: now })
      .onConflictDoUpdate({
        target: lampMode.id,
        set: { mode, speed: speed ?? null, updatedAtUtc: now },
      });
  } catch {
    // DB unreachable — the mode cannot be recorded; surface current state anyway.
  }

  return getControlsState();
}

/** True when at least one lamp's effective (desired-authoritative) state is on. */
async function anyLampCurrentlyOn(): Promise<boolean> {
  let rows: (typeof deviceState.$inferSelect)[] = [];
  try {
    rows = await db
      .select()
      .from(deviceState)
      .where(inArray(deviceState.entityId, [...LAMP_ENTITY_IDS]));
  } catch {
    return false;
  }
  const byEntityId = new Map(rows.map((r) => [r.entityId, r]));
  return LAMP_ENTITY_IDS.some((id) => effectiveLight(byEntityId.get(id)).on);
}
