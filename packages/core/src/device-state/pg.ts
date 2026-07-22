import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { stampCommandWindow } from "./command-window";
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

/** The end of the command window: `now` + windowMs (default COMMAND_WINDOW_MS). */
function windowEnd(now: Date, windowMs: number | undefined): Date {
  return windowMs === undefined ? stampCommandWindow(now) : new Date(now.getTime() + windowMs);
}

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
      await db
        .insert(deviceState)
        .values({
          ...input,
          desiredState: input.desired ?? null,
          reportedState: input.reported ?? null,
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
          set: { desiredState: input.desired, desiredAtUtc: now, desiredUntilUtc },
        });
    },

    async updateDesired(input: UpdateDesired) {
      const now = new Date();
      const desiredUntilUtc = windowEnd(now, input.windowMs);
      await db
        .update(deviceState)
        .set({ desiredState: input.desired, desiredAtUtc: now, desiredUntilUtc })
        .where(eq(deviceState.id, input.id));
    },

    async clearDesired(id: string) {
      await db
        .update(deviceState)
        .set({ desiredState: null, desiredAtUtc: null, desiredUntilUtc: null })
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
