/**
 * DB-authoritative climate enforcer (CC-unxz.2).
 *
 * Mirrors the light enforcer for the single house thermostat
 * (`env.CLIMATE_ENTITY_ID`). `device_state.desiredState` is the source of truth
 * for the AC's commandable fields (hvac mode, setpoint(s), fan_mode); HA is an
 * actuator. The AC's control policy is ENFORCE — the dashboard wins, so a change
 * made at the wall thermostat is overridden back to the panel's setting.
 *
 * Each cycle: snapshot HA's climate entities, find the house thermostat, and
 *   - seed desired from reported once when desired is null (no push), then
 *   - on drift, PUSH desired→HA (set_hvac_mode + set_temperature single/range +
 *     set_fan_mode as the desired specifies),
 *   - always write reportedState (incl. real ambient + hvac_action) so the panel
 *     reads ≤1s-fresh values with no HA call in the read path,
 *   - heartbeat to integration_sync_status.
 *
 * Ambient temperature and hvac_action are REPORTED-ONLY and always real HA values
 * (repo zero-fake-data rule). Multi-zone climate is out of scope — this enforcer
 * only manages the one configured house thermostat.
 */
import { eq } from "drizzle-orm";

import { db } from "../db/index";
import type { DeviceClimateState } from "../db/schema";
import { deviceState, integrationSyncStatus } from "../db/schema";
import { env } from "../env";
import { ha } from "../integrations/homeassistant";
import type { HaEntity } from "../integrations/homeassistant/types";
import {
  climateStateConverged,
  DeviceKind,
  isActivelyConditioning,
  isClimateState,
  type MappedHaState,
  mapHaToReported,
} from "./device-state-mapping";

const CLIMATE_ENFORCER_INTEGRATION_ID = "climate-enforcer";

// Stable device_state.id for the singleton house thermostat row.
const CLIMATE_DEVICE_ID = "climate-thermostat";

// The thermostat row as the reconciler needs it.
interface ManagedClimate {
  id: string;
  entityId: string;
  desiredState: DeviceClimateState | null;
  // App-command window: while now < desiredUntilUtc the freshly-set desired is
  // pushed regardless of policy. Climate is always enforce so it pushes on drift
  // anyway, but the window is honoured for symmetry with the light enforcer.
  desiredUntilUtc: Date | null;
}

export type ClimateEnforcementDecision =
  | { kind: "noop" }
  | { kind: "unreachable" }
  | { kind: "seed"; desired: DeviceClimateState }
  | { kind: "push"; desired: DeviceClimateState };

/**
 * Pure reconcile decision for the thermostat. No I/O — the cycle executes it.
 * Seed once (adopt reality as initial intent, no push); on drift push desired
 * (enforce + the command window both push); otherwise noop. Reported-only
 * ambient/action never count as drift (climateStateConverged ignores them).
 */
export function decideClimateEnforcement(
  device: ManagedClimate,
  mapped: MappedHaState,
  _now: Date = new Date(),
): ClimateEnforcementDecision {
  if (!mapped.available || mapped.reported == null || !isClimateState(mapped.reported)) {
    return { kind: "unreachable" };
  }
  const reported = mapped.reported;

  // Seed once: adopt current reality as the initial intent without pushing.
  if (device.desiredState == null) return { kind: "seed", desired: reported };

  // While the AC is actively heating/cooling it owns its blower and reports
  // fan_mode="on"; a desired fan_mode that disagrees is NOT drift to fight, or we
  // get the on/off/on/off flicker (CC-pu4m). Yield the fan dimension then.
  const conditioning = isActivelyConditioning(reported);
  if (climateStateConverged(device.desiredState, reported, { ignoreFan: conditioning })) {
    return { kind: "noop" };
  }

  // Real mode/setpoint drift: push desired (enforce). While conditioning, strip
  // fan_mode from the push so we still never actuate the blower the AC controls.
  const desired = conditioning
    ? { ...device.desiredState, fanMode: undefined }
    : device.desiredState;
  return { kind: "push", desired };
}

export async function runClimateEnforcerCycle(): Promise<void> {
  try {
    const entities = await ha.getEntities("climate");
    const entity = entities.find((e) => e.entity_id === env.CLIMATE_ENTITY_ID);
    await reconcileClimate(entity);
    await markHeartbeat(null);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markHeartbeat(msg);
  }
}

async function reconcileClimate(entity: HaEntity | undefined): Promise<void> {
  const now = new Date();
  const row = await loadClimateRow();
  const mapped = mapHaToReported(DeviceKind.Climate, entity);

  // No row yet AND the entity is unreachable: nothing to seed from, nothing to
  // write (we never fabricate a row from thin air). Wait for HA to report.
  if (!row && (!mapped.available || mapped.reported == null)) return;

  // First sight with a reachable entity: insert the seed row (desired = reported,
  // no push) so the panel has something to read immediately.
  if (!row) {
    await db.insert(deviceState).values({
      id: CLIMATE_DEVICE_ID,
      kind: DeviceKind.Climate,
      entityId: env.CLIMATE_ENTITY_ID,
      domain: "climate",
      label: "Thermostat",
      reportedState: mapped.reported,
      reportedAtUtc: now,
      desiredState: mapped.reported,
      desiredAtUtc: now,
      available: true,
    });
    return;
  }

  const device: ManagedClimate = {
    id: row.id,
    entityId: row.entityId,
    desiredState: isClimateState(row.desiredState) ? row.desiredState : null,
    desiredUntilUtc: row.desiredUntilUtc ?? null,
  };
  const decision = decideClimateEnforcement(device, mapped, now);
  await applyDecision(device, decision, mapped, now);
}

async function loadClimateRow(): Promise<typeof deviceState.$inferSelect | undefined> {
  const rows = await db
    .select()
    .from(deviceState)
    .where(eq(deviceState.id, CLIMATE_DEVICE_ID))
    .limit(1);
  return rows[0];
}

async function applyDecision(
  device: ManagedClimate,
  decision: ClimateEnforcementDecision,
  mapped: MappedHaState,
  now: Date,
): Promise<void> {
  const reportedFields = { reportedState: mapped.reported, reportedAtUtc: now };

  switch (decision.kind) {
    case "unreachable": {
      // Honest availability — never paint desired as a real reading when down.
      await db
        .update(deviceState)
        .set({ ...reportedFields, available: false, updatedAtUtc: now })
        .where(eq(deviceState.id, device.id));
      return;
    }
    case "seed": {
      await db
        .update(deviceState)
        .set({
          ...reportedFields,
          desiredState: decision.desired,
          desiredAtUtc: now,
          available: true,
          updatedAtUtc: now,
        })
        .where(eq(deviceState.id, device.id));
      return;
    }
    case "push": {
      await pushToHa(device.entityId, decision.desired);
      await db
        .update(deviceState)
        .set({ ...reportedFields, available: true, updatedAtUtc: now })
        .where(eq(deviceState.id, device.id));
      return;
    }
    case "noop": {
      await db
        .update(deviceState)
        .set({ ...reportedFields, available: true, updatedAtUtc: now })
        .where(eq(deviceState.id, device.id));
      return;
    }
  }
}

/**
 * Actuate the desired climate state onto HA: hvac mode, then the setpoint shape
 * the desired carries (single `temperature` or the heat_cool range), then fan
 * mode when specified. Only the fields desired specifies are pushed.
 */
async function pushToHa(entityId: string, desired: DeviceClimateState): Promise<void> {
  await ha.callService("climate", "set_hvac_mode", {
    entity_id: entityId,
    hvac_mode: desired.mode,
  });
  if (desired.targetLow != null && desired.targetHigh != null) {
    await ha.callService("climate", "set_temperature", {
      entity_id: entityId,
      target_temp_low: desired.targetLow,
      target_temp_high: desired.targetHigh,
    });
  } else if (desired.target != null) {
    await ha.callService("climate", "set_temperature", {
      entity_id: entityId,
      temperature: desired.target,
    });
  }
  if (desired.fanMode != null) {
    await ha.callService("climate", "set_fan_mode", {
      entity_id: entityId,
      fan_mode: desired.fanMode,
    });
  }
}

async function markHeartbeat(error: string | null): Promise<void> {
  const now = new Date();
  const consecutiveFailures = error ? (await currentFailureStreak()) + 1 : 0;
  await db
    .insert(integrationSyncStatus)
    .values({
      integrationId: CLIMATE_ENFORCER_INTEGRATION_ID,
      lastPolledAtUtc: now,
      lastError: error,
      consecutiveFailures,
    })
    .onConflictDoUpdate({
      target: integrationSyncStatus.integrationId,
      set: { lastPolledAtUtc: now, lastError: error, consecutiveFailures },
    });
}

async function currentFailureStreak(): Promise<number> {
  const rows = await db
    .select({ n: integrationSyncStatus.consecutiveFailures })
    .from(integrationSyncStatus)
    .where(eq(integrationSyncStatus.integrationId, CLIMATE_ENFORCER_INTEGRATION_ID))
    .limit(1);
  return rows[0]?.n ?? 0;
}

/** The stable device_state id of the singleton thermostat row (for reads). */
export { CLIMATE_DEVICE_ID };
