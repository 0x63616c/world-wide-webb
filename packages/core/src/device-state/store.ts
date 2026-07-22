import type { DeviceKind, DeviceStateValue, deviceState } from "./schema";

/** A device_state row as read back from the store (drizzle row shape). */
export type DeviceStateRow = typeof deviceState.$inferSelect;

/** Upsert of desired keyed on entityId — creates the row (available:true) on first sight. */
export interface UpsertDesired {
  id: string;
  kind: DeviceKind;
  entityId: string;
  domain: string;
  label: string;
  desired: DeviceStateValue;
  /** Command-window length in ms; defaults to COMMAND_WINDOW_MS. */
  windowMs?: number;
}

/** In-place update of an existing row's desired, keyed on id. Missing row = silent no-op. */
export interface UpdateDesired {
  id: string;
  desired: DeviceStateValue;
  windowMs?: number;
}

/**
 * First-sight row creation by a reconcile loop. Conflict on entityId = no-op.
 * The store owns the "when" stamps: `reportedAtUtc` is set when `reported` is
 * provided, `desiredAtUtc` when `desired` is provided (a row seeded WITH data
 * but a null timestamp for it is semantically incoherent) , callers never pass
 * a timestamp for data they didn't give.
 */
export interface SeedDevice {
  id: string;
  kind: DeviceKind;
  entityId: string;
  domain: string;
  label: string;
  reported?: DeviceStateValue | null;
  desired?: DeviceStateValue | null;
  available: boolean;
  /** Injectable clock for deterministic tests; defaults to new Date(). */
  now?: Date;
}

/** One reconcile-cycle persistence of observed state, keyed on id. */
export interface WriteReported {
  id: string;
  reported: DeviceStateValue | null;
  available: boolean;
  /** True when the reported VALUE changed vs the previous cycle → stamps reportedChangedAtUtc. */
  changed?: boolean;
  /** Adopt: absorb external drift — also write this as desired (+desiredAtUtc), no window. */
  adoptDesired?: DeviceStateValue;
  /** Injectable clock for deterministic tests; defaults to new Date(). */
  now?: Date;
}

export interface ListFilter {
  kind?: DeviceKind;
  entityIds?: readonly string[];
}

/**
 * The device-state store: the ONLY code that touches the device_state table.
 * DB failures always throw — a desired write is the mutation's only effect; a
 * swallowed error is fabricated success (carried from desired-state-store).
 * A missing row is NOT a DB failure: updateDesired, clearDesired and
 * writeReported key on an existing row and are silent no-ops when it isn't
 * there (mirrors the pg adapter's UPDATE affecting 0 rows). See each method's
 * doc for its exact semantics.
 */
export interface DeviceStateStore {
  read(id: string): Promise<DeviceStateRow | null>;
  list(filter?: ListFilter): Promise<DeviceStateRow[]>;
  /** Rows whose desiredUntilUtc is non-null and < now. */
  listExpiredWindows(now: Date): Promise<DeviceStateRow[]>;
  /** read(id) + mergeDeviceState overlay; null when the row is missing. */
  readEffective(id: string): Promise<MergedDeviceState | null>;
  seed(input: SeedDevice): Promise<void>;
  upsertDesired(input: UpsertDesired): Promise<void>;
  /** In-place update of an existing row's desired, keyed on id. Missing row = silent no-op. */
  updateDesired(input: UpdateDesired): Promise<void>;
  /** Null the desired triple (state/at/until), keyed on id. Missing row = silent no-op. */
  clearDesired(id: string): Promise<void>;
  /** Persist one reconcile-cycle's observed state, keyed on id. Missing row = silent no-op. */
  writeReported(input: WriteReported): Promise<void>;
}

/**
 * The desired-overlaid view of a device_state row. Until Task 4 lands the shared
 * merge module, this shape mirrors `MergedDeviceState` from
 * `api/src/services/device-state-mapping.ts` exactly — Task 4 swaps the named
 * type in without changing callers.
 */
export interface MergedDeviceState {
  state: DeviceStateValue | null;
  pending: boolean;
  available: boolean;
}
