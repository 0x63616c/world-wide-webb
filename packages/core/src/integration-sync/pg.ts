import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { integrationSyncStatus } from "./schema";
import type { IntegrationSyncRow, IntegrationSyncStore } from "./store";

/** The minimal structural surface this adapter needs from a drizzle db instance. */
export type PgIntegrationSyncDb = Pick<
  NodePgDatabase<Record<string, unknown>>,
  "select" | "insert"
>;

/** A pg-backed `IntegrationSyncStore` over the shared `integration_sync_status` table. */
export function createPgIntegrationSyncStore(db: PgIntegrationSyncDb): IntegrationSyncStore {
  // NOTE: `updatedAtUtc` is intentionally OMITTED from `onConflictDoUpdate.set` —
  // it keeps its first-insert `defaultNow()` value on update. This mirrors the
  // original `integration-heartbeat` write exactly ("no behavior change").
  async function write(
    integrationId: string,
    error: string | null,
    consecutiveFailures: number,
  ): Promise<void> {
    const now = new Date();
    await db
      .insert(integrationSyncStatus)
      .values({ integrationId, lastPolledAtUtc: now, lastError: error, consecutiveFailures })
      .onConflictDoUpdate({
        target: integrationSyncStatus.integrationId,
        set: { lastPolledAtUtc: now, lastError: error, consecutiveFailures },
      });
  }

  return {
    async read(integrationId): Promise<IntegrationSyncRow | null> {
      const rows = await db
        .select()
        .from(integrationSyncStatus)
        .where(eq(integrationSyncStatus.integrationId, integrationId))
        .limit(1);
      return rows[0] ?? null;
    },

    async recordOk(integrationId) {
      await write(integrationId, null, 0);
    },

    async recordFail(integrationId, error) {
      const rows = await db
        .select({ n: integrationSyncStatus.consecutiveFailures })
        .from(integrationSyncStatus)
        .where(eq(integrationSyncStatus.integrationId, integrationId))
        .limit(1);
      const consecutiveFailures = (rows[0]?.n ?? 0) + 1;
      await write(integrationId, error, consecutiveFailures);
      return consecutiveFailures;
    },
  };
}
