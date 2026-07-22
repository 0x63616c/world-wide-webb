import { stampCommandWindow } from "./command-window";
import type { DeviceClimateState, DeviceLightState, DeviceStateValue, LightColor } from "./schema";
import type {
  DeviceStateRow,
  DeviceStateStore,
  ListFilter,
  MergedDeviceState,
  SeedDevice,
  UpdateDesired,
  UpsertDesired,
  WriteReported,
} from "./store";

/** The end of the command window: `now` + windowMs (default COMMAND_WINDOW_MS). */
function windowEnd(now: Date, windowMs: number | undefined): Date {
  return windowMs === undefined ? stampCommandWindow(now) : new Date(now.getTime() + windowMs);
}

/** Structural clone of a row so callers never share mutable references with the store. */
function cloneRow(row: DeviceStateRow): DeviceStateRow {
  return structuredClone(row);
}

// ─── TODO(task-4): replace with core merge module ─────────────────────────────
// The following helpers are copied verbatim (behavior-for-behavior) from
// `api/src/services/device-state-mapping.ts` so `readEffective` matches the
// enforcer's merge semantics until the shared merge module lands in Task 4,
// which deletes this whole block and imports the real thing instead.

function isLightState(v: DeviceStateValue | null | undefined): v is DeviceLightState {
  return v != null && typeof (v as DeviceLightState).on === "boolean";
}

function isClimateState(v: DeviceStateValue | null | undefined): v is DeviceClimateState {
  return (
    v != null &&
    typeof (v as DeviceClimateState).mode === "string" &&
    typeof (v as DeviceLightState).on !== "boolean"
  );
}

const HvacModeValue = { Off: "off" } as const;

function sanitizeClimateDesired(state: DeviceClimateState): DeviceClimateState {
  const clean: DeviceClimateState = { mode: state.mode };
  if (state.target != null) clean.target = state.target;
  if (state.targetLow != null) clean.targetLow = state.targetLow;
  if (state.targetHigh != null) clean.targetHigh = state.targetHigh;
  if (state.fanMode != null) clean.fanMode = state.fanMode;
  return clean;
}

function climateSetpointsObservable(state: DeviceClimateState): boolean {
  return state.mode !== HvacModeValue.Off;
}

function climateStateConverged(
  desired: DeviceClimateState,
  reported: DeviceClimateState,
  opts: { ignoreFan?: boolean } = {},
): boolean {
  if (desired.mode !== reported.mode) return false;
  if (climateSetpointsObservable(reported)) {
    if (desired.target != null && desired.target !== reported.target) return false;
    if (desired.targetLow != null && desired.targetLow !== reported.targetLow) return false;
    if (desired.targetHigh != null && desired.targetHigh !== reported.targetHigh) return false;
  }
  if (!opts.ignoreFan && desired.fanMode != null && desired.fanMode !== reported.fanMode) {
    return false;
  }
  return true;
}

const RGB_CHANNEL_TOLERANCE = 12;
const KELVIN_TOLERANCE = 250;
const BRIGHTNESS_TOLERANCE = 3;

function colorConverged(a: LightColor | undefined, b: LightColor | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const aKelvin = a.kelvin != null;
  const bKelvin = b.kelvin != null;
  if (aKelvin !== bKelvin) return false;
  if (aKelvin && bKelvin) return Math.abs((a.kelvin ?? 0) - (b.kelvin ?? 0)) <= KELVIN_TOLERANCE;
  const ar = a.rgb;
  const br = b.rgb;
  if (!ar || !br) return !ar && !br;
  return ar.every((c, i) => Math.abs(c - (br[i] as number)) <= RGB_CHANNEL_TOLERANCE);
}

function converged(desired: DeviceStateValue, reported: DeviceStateValue): boolean {
  if (isClimateState(desired) || isClimateState(reported)) {
    if (!isClimateState(desired) || !isClimateState(reported)) return false;
    return climateStateConverged(desired, reported);
  }
  if (!isLightState(desired) || !isLightState(reported)) return false;
  if (desired.on !== reported.on) return false;
  if (!desired.on) return true;
  if (
    desired.brightness != null &&
    reported.brightness != null &&
    Math.abs(desired.brightness - reported.brightness) > BRIGHTNESS_TOLERANCE
  ) {
    return false;
  }
  if (desired.color != null && !colorConverged(desired.color, reported.color)) {
    return false;
  }
  return true;
}

function mergeDeviceState(device: {
  reportedState?: DeviceStateValue | null;
  desiredState?: DeviceStateValue | null;
  available: boolean;
}): MergedDeviceState {
  const desired = device.desiredState ?? null;
  const reported = device.reportedState ?? null;
  if (desired != null) {
    const overlay = isClimateState(desired) ? sanitizeClimateDesired(desired) : desired;
    const state = reported != null ? { ...reported, ...overlay } : desired;
    const pending = reported == null ? true : !converged(desired, reported);
    return { state, pending, available: device.available };
  }
  return { state: reported, pending: false, available: device.available };
}

// ─── end TODO(task-4) block ────────────────────────────────────────────────

/** An in-memory `DeviceStateStore`: a `Map<id, DeviceStateRow>` for tests and local dev. */
export function createInMemoryDeviceStateStore(): DeviceStateStore {
  const rows = new Map<string, DeviceStateRow>();

  function findByEntityId(entityId: string): DeviceStateRow | undefined {
    for (const row of rows.values()) {
      if (row.entityId === entityId) return row;
    }
    return undefined;
  }

  return {
    async read(id) {
      const row = rows.get(id);
      return row ? cloneRow(row) : null;
    },

    async list(filter?: ListFilter) {
      let result = Array.from(rows.values());
      if (filter?.kind !== undefined) {
        result = result.filter((r) => r.kind === filter.kind);
      }
      if (filter?.entityIds !== undefined) {
        const ids = new Set(filter.entityIds);
        result = result.filter((r) => ids.has(r.entityId));
      }
      return result.map(cloneRow);
    },

    async listExpiredWindows(now: Date) {
      return Array.from(rows.values())
        .filter((r) => r.desiredUntilUtc != null && r.desiredUntilUtc < now)
        .map(cloneRow);
    },

    async readEffective(id) {
      const row = rows.get(id);
      if (!row) return null;
      return mergeDeviceState(row);
    },

    async seed(input: SeedDevice) {
      const existing = findByEntityId(input.entityId);
      if (existing) return;
      const now = new Date();
      const row: DeviceStateRow = {
        id: input.id,
        kind: input.kind,
        entityId: input.entityId,
        domain: input.domain,
        label: input.label,
        reportedState: input.reported ?? null,
        reportedAtUtc: null,
        reportedChangedAtUtc: null,
        desiredState: input.desired ?? null,
        desiredAtUtc: null,
        desiredUntilUtc: null,
        available: input.available,
        createdAtUtc: now,
        updatedAtUtc: now,
      };
      rows.set(input.id, row);
    },

    async upsertDesired(input: UpsertDesired) {
      const now = new Date();
      const desiredUntilUtc = windowEnd(now, input.windowMs);
      const existing = findByEntityId(input.entityId);
      if (existing) {
        existing.desiredState = input.desired;
        existing.desiredAtUtc = now;
        existing.desiredUntilUtc = desiredUntilUtc;
        existing.updatedAtUtc = now;
        return;
      }
      const row: DeviceStateRow = {
        id: input.id,
        kind: input.kind,
        entityId: input.entityId,
        domain: input.domain,
        label: input.label,
        reportedState: null,
        reportedAtUtc: null,
        reportedChangedAtUtc: null,
        desiredState: input.desired,
        desiredAtUtc: now,
        desiredUntilUtc: desiredUntilUtc,
        available: true,
        createdAtUtc: now,
        updatedAtUtc: now,
      };
      rows.set(input.id, row);
    },

    async updateDesired(input: UpdateDesired) {
      const row = rows.get(input.id);
      if (!row) return;
      const now = new Date();
      const desiredUntilUtc = windowEnd(now, input.windowMs);
      row.desiredState = input.desired;
      row.desiredAtUtc = now;
      row.desiredUntilUtc = desiredUntilUtc;
      row.updatedAtUtc = now;
    },

    async clearDesired(id: string) {
      const row = rows.get(id);
      if (!row) return;
      row.desiredState = null;
      row.desiredAtUtc = null;
      row.desiredUntilUtc = null;
      row.updatedAtUtc = new Date();
    },

    async writeReported(input: WriteReported) {
      const row = rows.get(input.id);
      if (!row) return;
      const now = input.now ?? new Date();
      row.reportedState = input.reported;
      row.reportedAtUtc = now;
      row.available = input.available;
      row.updatedAtUtc = now;
      if (input.changed) {
        row.reportedChangedAtUtc = now;
      }
      if (input.adoptDesired !== undefined) {
        row.desiredState = input.adoptDesired;
        row.desiredAtUtc = now;
      }
    },
  };
}
