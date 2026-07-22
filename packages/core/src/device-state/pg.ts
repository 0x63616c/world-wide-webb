import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { windowEnd } from "./command-window";
import { mergeDeviceState } from "./merge";
import { deviceState } from "./schema";
import type {
  DeviceStateRow,
  DeviceStateStore,
  ListFilter,
  SeedDevice,
  UpdateDesired,
  UpsertDesired,
  WriteReported,
} from "./store";

/** The minimal structural surface this adapter needs from a drizzle db instance. */
export type PgDeviceStateDb = Pick<
  NodePgDatabase<Record<string, unknown>>,
  "select" | "insert" | "update"
>;

/** A pg-backed `DeviceStateStore` over the shared `device_state` table (drizzle). */
export function createPgDeviceStateStore(db: PgDeviceStateDb): DeviceStateStore {
  async function read(id: string): Promise<DeviceStateRow | null> {
    const rows = await db.select().from(deviceState).where(eq(deviceState.id, id)).limit(1);
    return rows[0] ?? null;
  }

  return {
    read,

    async list(filter?: ListFilter) {
      if (filter?.kind !== undefined && filter?.entityIds !== undefined) {
        return db
          .select()
          .from(deviceState)
          .where(
            and(
              eq(deviceState.kind, filter.kind),
              inArray(deviceState.entityId, [...filter.entityIds]),
            ),
          );
      }
      if (filter?.kind !== undefined) {
        return db.select().from(deviceState).where(eq(deviceState.kind, filter.kind));
      }
      if (filter?.entityIds !== undefined) {
        return db
          .select()
          .from(deviceState)
          .where(inArray(deviceState.entityId, [...filter.entityIds]));
      }
      return db.select().from(deviceState);
    },

    async listExpiredWindows(now: Date) {
      return db
        .select()
        .from(deviceState)
        .where(and(isNotNull(deviceState.desiredUntilUtc), lt(deviceState.desiredUntilUtc, now)));
    },

    async readEffective(id: string) {
      const row = await read(id);
      if (!row) return null;
      return mergeDeviceState(row);
    },

    async seed(input: SeedDevice) {
      const now = input.now ?? new Date();
      // createdAtUtc/updatedAtUtc are NOT set here — they come from the
      // column's `defaultNow()` (the DB server clock), which can differ from
      // `input.now` (the memory adapter's clock). Known and accepted: nothing
      // reads updatedAtUtc today (verified in the A8/A9 reviews).
      const { now: _now, reported, desired, ...rest } = input;
      await db
        .insert(deviceState)
        .values({
          ...rest,
          desiredState: desired ?? null,
          desiredAtUtc: desired != null ? now : null,
          reportedState: reported ?? null,
          reportedAtUtc: reported != null ? now : null,
        })
        .onConflictDoNothing({ target: deviceState.entityId });
    },

    async upsertDesired(input: UpsertDesired) {
      const now = new Date();
      const desiredUntilUtc = windowEnd(now, input.windowMs);
      await db
        .insert(deviceState)
        .values({
          id: input.id,
          kind: input.kind,
          entityId: input.entityId,
          domain: input.domain,
          label: input.label,
          desiredState: input.desired,
          desiredAtUtc: now,
          desiredUntilUtc,
          available: true,
        })
        .onConflictDoUpdate({
          target: deviceState.entityId,
          set: {
            desiredState: input.desired,
            desiredAtUtc: now,
            desiredUntilUtc,
            updatedAtUtc: now,
          },
        });
    },

    async updateDesired(input: UpdateDesired) {
      const now = new Date();
      const desiredUntilUtc = windowEnd(now, input.windowMs);
      await db
        .update(deviceState)
        .set({ desiredState: input.desired, desiredAtUtc: now, desiredUntilUtc, updatedAtUtc: now })
        .where(eq(deviceState.id, input.id));
    },

    async clearDesired(id: string) {
      const now = new Date();
      await db
        .update(deviceState)
        .set({ desiredState: null, desiredAtUtc: null, desiredUntilUtc: null, updatedAtUtc: now })
        .where(eq(deviceState.id, id));
    },

    async writeReported(input: WriteReported) {
      const now = input.now ?? new Date();
      await db
        .update(deviceState)
        .set({
          reportedState: input.reported,
          reportedAtUtc: now,
          available: input.available,
          updatedAtUtc: now,
          ...(input.changed ? { reportedChangedAtUtc: now } : {}),
          ...(input.adoptDesired !== undefined
            ? { desiredState: input.adoptDesired, desiredAtUtc: now }
            : {}),
        })
        .where(eq(deviceState.id, input.id));
    },
  };
}
