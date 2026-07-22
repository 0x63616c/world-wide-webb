import { stampCommandWindow } from "./command-window";
import { mergeDeviceState } from "./merge";
import type {
  DeviceStateRow,
  DeviceStateStore,
  ListFilter,
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
      // Merge on a clone so `state` (a spread/passthrough of desired/reported)
      // never carries a reference back into the store's own row objects.
      return mergeDeviceState(cloneRow(row));
    },

    async seed(input: SeedDevice) {
      const existing = findByEntityId(input.entityId);
      if (existing) return;
      const now = input.now ?? new Date();
      const row: DeviceStateRow = {
        id: input.id,
        kind: input.kind,
        entityId: input.entityId,
        domain: input.domain,
        label: input.label,
        reportedState: input.reported ?? null,
        reportedAtUtc: input.reported != null ? now : null,
        reportedChangedAtUtc: null,
        desiredState: input.desired ?? null,
        desiredAtUtc: input.desired != null ? now : null,
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
