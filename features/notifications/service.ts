import { genId } from "@www/platform";
import { and, asc, eq, gt, isNotNull, isNull, lt, sql } from "drizzle-orm";
import {
  type NotificationInput,
  notificationInputSchema,
  notificationListSchema,
} from "./contract";
import { db } from "./db";
import { notifications } from "./schema";

const nextRevision = sql`nextval('notification_revision')`;
function wire(row: typeof notifications.$inferSelect) {
  return {
    ...row,
    revision: row.revision.toString(),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    read_at: row.read_at?.toISOString() ?? null,
    dismissed_at: row.dismissed_at?.toISOString() ?? null,
  };
}

export function createNotificationService(database: typeof db) {
  // Serialize revision allocation AND commit across every writer/process. Readers
  // take the same lock so a cursor can never skip an uncommitted lower revision.
  const locked = <T>(
    fn: (tx: Parameters<Parameters<typeof database.transaction>[0]>[0]) => Promise<T>,
  ) =>
    database.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(580058)`);
      return fn(tx);
    });
  return {
    async create(raw: NotificationInput) {
      const input = notificationInputSchema.parse(raw);
      return locked(async (tx) => {
        const [row] = await tx
          .insert(notifications)
          .values({ id: genId("ntf"), ...input })
          .onConflictDoUpdate({
            target: [notifications.source_module, notifications.dedupe_key],
            targetWhere: sql`${notifications.dismissed_at} IS NULL`,
            set: {
              ...input,
              created_at: sql`clock_timestamp()`,
              updated_at: sql`clock_timestamp()`,
              read_at: null,
              revision: nextRevision,
            },
          })
          .returning();
        return wire(row);
      });
    },
    async list(raw: unknown = {}) {
      const input = notificationListSchema.parse(raw);
      return locked(async (tx) => {
        const rows = await tx
          .select()
          .from(notifications)
          .where(
            and(
              input.since === undefined
                ? isNull(notifications.dismissed_at)
                : gt(notifications.revision, BigInt(input.since)),
              input.unread === "true"
                ? and(isNull(notifications.read_at), isNull(notifications.dismissed_at))
                : input.unread === "false"
                  ? isNotNull(notifications.read_at)
                  : undefined,
            ),
          )
          .orderBy(asc(notifications.revision))
          .limit(input.limit + 1);
        const items = rows.slice(0, input.limit).map(wire);
        return {
          items,
          cursor: items.at(-1)?.revision ?? input.since ?? "0",
          has_more: rows.length > input.limit,
        };
      });
    },
    async act(id: string, action: "read" | "dismiss") {
      return locked(async (tx) => {
        const [row] = await tx
          .update(notifications)
          .set({
            ...(action === "read"
              ? { read_at: sql`coalesce(${notifications.read_at}, clock_timestamp())` }
              : { dismissed_at: sql`coalesce(${notifications.dismissed_at}, clock_timestamp())` }),
            updated_at: sql`clock_timestamp()`,
            revision: nextRevision,
          })
          .where(eq(notifications.id, id))
          .returning();
        return row ? wire(row) : null;
      });
    },
    async dismissAll() {
      return locked(async (tx) => {
        const rows = await tx
          .update(notifications)
          .set({
            dismissed_at: sql`clock_timestamp()`,
            updated_at: sql`clock_timestamp()`,
            revision: nextRevision,
          })
          .where(isNull(notifications.dismissed_at))
          .returning({ id: notifications.id });
        return { dismissed: rows.length };
      });
    },
    async prune() {
      return locked(async (tx) => {
        const rows = await tx
          .delete(notifications)
          .where(
            and(
              isNotNull(notifications.dismissed_at),
              lt(notifications.dismissed_at, sql`now() - interval '30 days'`),
            ),
          )
          .returning({ id: notifications.id });
        return rows.length;
      });
    },
  };
}
export const notificationService = createNotificationService(db);
/** @public Any backend feature may notify via this validated, durable helper. */
export const createNotification = (input: NotificationInput) => notificationService.create(input);
