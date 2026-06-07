/**
 * Party mode engine + reconciler (www-7d5b.3.3).
 *
 * Party is a persistent lamp mode (the `lamp_mode` singleton row is truth). This
 * module has two halves:
 *
 *  1. The ENGINE — an in-process animation loop that, each tick, drives every
 *     lamp to its `partyColorsAtTick` colour via `light.turn_on` with an HA
 *     `transition` crossfade. Timing is too fine-grained to route through the 1s
 *     enforcer, so the engine talks to HA directly. await-before-reschedule so
 *     ticks never overlap; per-tick try/catch so a transient HA error can't kill
 *     the loop.
 *  2. reconcilePartyMode() — a ~2s Worker that reads the DB row + lamp on-state
 *     and starts/stops/restarts the engine. Because the DB row is truth, party
 *     survives a worker restart: the reconciler re-arms the engine on next cycle.
 *
 * The enforcer yields the COLOUR dimension to the engine while mode=party (it
 * still enforces on/off), so the two never fight over lamp colour.
 */
import { eq } from "drizzle-orm";

import {
  LAMP_MODE_SPEED_CONFIG,
  LampMode,
  LampModeSpeed,
  partyColorsAtTick,
  type RgbColor,
} from "../config/lamp-scenes";
import { LAMP_ENTITY_IDS } from "../config/lights";
import { db } from "../db/index";
import { deviceState, LAMP_MODE_SINGLETON_ID, lampMode } from "../db/schema";
import { ha } from "../integrations/homeassistant";
import { HaLightService } from "./device-command-service";
import { isLightState } from "./device-state-mapping";

// ─── pure helpers ──────────────────────────────────────────────────────────────

/** Coerce a stored speed string to a valid LampModeSpeed, defaulting to Medium. */
export function coerceSpeed(speed: string | null | undefined): LampModeSpeed {
  return speed === LampModeSpeed.Slow ||
    speed === LampModeSpeed.Fast ||
    speed === LampModeSpeed.Medium
    ? speed
    : LampModeSpeed.Medium;
}

/** Build the `light.turn_on` params for one lamp in the party wave. */
export function partyTurnOnParams(
  entityId: string,
  rgb: RgbColor,
  speed: LampModeSpeed,
): Record<string, unknown> {
  return {
    entity_id: entityId,
    rgb_color: rgb,
    transition: LAMP_MODE_SPEED_CONFIG[speed].transitionS,
  };
}

interface LampModeRow {
  mode: string;
  speed: string | null;
}

export interface PartyAction {
  kind: "start" | "stop" | "noop";
  speed?: LampModeSpeed;
}

export interface EngineStatus {
  running: boolean;
  speed: LampModeSpeed | null;
}

/**
 * Pure reconcile decision: given the DB row, lamp on-state, and current engine
 * status, what should happen to the engine? party + a lamp on + (not running or
 * speed changed) → (re)start; none or all lamps off → stop; else noop.
 */
export function decidePartyAction(
  row: LampModeRow,
  lamps: { anyLampOn: boolean },
  status: EngineStatus,
): PartyAction {
  const wantParty = row.mode === LampMode.Party && lamps.anyLampOn;

  if (!wantParty) return status.running ? { kind: "stop" } : { kind: "noop" };

  const speed = coerceSpeed(row.speed);
  if (status.running && status.speed === speed) return { kind: "noop" };
  return { kind: "start", speed };
}

// ─── engine ──────────────────────────────────────────────────────────────────

export interface PartyEngine {
  start(speed: LampModeSpeed): void;
  stop(): void;
  status(): EngineStatus;
}

/**
 * Create a party animation engine. State lives in this closure (no module-global
 * mutable vars). One tick computes the wave colours and fires one
 * `light.turn_on`-with-transition per lamp; the next tick is scheduled only after
 * the current one settles (await-before-reschedule).
 */
export function createPartyEngine(): PartyEngine {
  let speed: LampModeSpeed | null = null;
  let tick = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  const runTick = async (): Promise<void> => {
    if (!running || speed == null) return;
    const activeSpeed = speed;
    try {
      const colors = partyColorsAtTick(tick, LAMP_ENTITY_IDS.length);
      await Promise.all(
        LAMP_ENTITY_IDS.map((entityId, i) =>
          ha.callService(
            "light",
            HaLightService.TurnOn,
            partyTurnOnParams(entityId, colors[i], activeSpeed),
          ),
        ),
      );
      tick += 1;
    } catch {
      // Transient HA error — skip this tick, keep the loop alive for the next.
    }
    if (!running) return;
    timer = setTimeout(() => void runTick(), LAMP_MODE_SPEED_CONFIG[activeSpeed].intervalMs);
  };

  return {
    start(next: LampModeSpeed) {
      // Restart cleanly so a speed change re-times immediately; preserve tick so
      // the wave continues its phase rather than snapping back to colour 0.
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      speed = next;
      running = true;
      void runTick();
    },
    stop() {
      running = false;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
    status() {
      return { running, speed };
    },
  };
}

// The single live engine for the worker process. A module-level handle (not
// mutable state) — the mutable bits are encapsulated in the closure above.
const partyEngine = createPartyEngine();

export function startPartyEngine(speed: LampModeSpeed): void {
  partyEngine.start(speed);
}
export function stopPartyEngine(): void {
  partyEngine.stop();
}
export function partyEngineStatus(): EngineStatus {
  return partyEngine.status();
}

// ─── reconciler (worker cycle) ──────────────────────────────────────────────────

/**
 * One reconcile cycle (registered as a ~2s Worker). Reads the lamp_mode row and
 * lamp on-state (from desired, the source of truth) and drives the engine. The
 * engine is injected so tests can stub it; defaults to the live process engine.
 */
export async function reconcilePartyMode(engine: PartyEngine = partyEngine): Promise<void> {
  const row = await readLampModeRow();
  const anyLampOn = await anyLampDesiredOn();

  const action = decidePartyAction(row, { anyLampOn }, engine.status());
  if (action.kind === "start" && action.speed) engine.start(action.speed);
  else if (action.kind === "stop") engine.stop();
}

async function readLampModeRow(): Promise<LampModeRow> {
  const rows = await db
    .select()
    .from(lampMode)
    .where(eq(lampMode.id, LAMP_MODE_SINGLETON_ID))
    .limit(1);
  const row = rows[0];
  // No row yet = mode none (party never enabled). Default safe.
  return { mode: row?.mode ?? LampMode.None, speed: row?.speed ?? null };
}

/** True when at least one managed lamp's DESIRED state is on (desired = truth). */
async function anyLampDesiredOn(): Promise<boolean> {
  const lampIds = new Set<string>(LAMP_ENTITY_IDS);
  const rows = await db.select().from(deviceState);
  return rows.some(
    (r) =>
      lampIds.has(r.entityId) && r.available && isLightState(r.desiredState) && r.desiredState.on,
  );
}
