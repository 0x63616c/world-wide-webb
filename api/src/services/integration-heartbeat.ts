import { getLogger } from "@www/logger";
import { eq } from "drizzle-orm";

import { db } from "../db/index";
import { integrationSyncStatus } from "../db/schema";

/**
 * Per-integration liveness + failure-streak recorder against
 * `integration_sync_status` (www-355t.9). `consecutiveFailures` is a real streak:
 * reset to 0 on success, prior value + 1 on error. A single in-process poller runs
 * ticks sequentially, so the read-modify-write is race-free.
 *
 * NOTE: github-actions keeps its own poller status in `github_poll_status` (a
 * different table with extra fields), so it does not use this helper.
 */
export interface IntegrationHeartbeat {
  /** Record a successful cycle: fresh poll time, no error, streak reset to 0. */
  ok(): Promise<void>;
  /** Record a failed cycle; returns the new consecutive-failure streak. */
  fail(error: string): Promise<number>;
}

export function heartbeat(integrationId: string): IntegrationHeartbeat {
  async function currentStreak(): Promise<number> {
    const rows = await db
      .select({ n: integrationSyncStatus.consecutiveFailures })
      .from(integrationSyncStatus)
      .where(eq(integrationSyncStatus.integrationId, integrationId))
      .limit(1);
    return rows[0]?.n ?? 0;
  }

  async function write(error: string | null, consecutiveFailures: number): Promise<void> {
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
    async ok() {
      await write(null, 0);
    },
    async fail(error: string) {
      const consecutiveFailures = (await currentStreak()) + 1;
      await write(error, consecutiveFailures);
      return consecutiveFailures;
    },
  };
}

/**
 * Run one reconcile cycle and record the heartbeat: on success mark ok, on failure
 * log the error with the new streak and mark fail. Used by the enforcer/sync
 * cycles that share the try/reconcile/heartbeat shape. `label` names the cycle in
 * the failure log ("<label> cycle failed").
 */
export async function runCycle(
  hb: IntegrationHeartbeat,
  label: string,
  work: () => Promise<void>,
): Promise<void> {
  try {
    await work();
    await hb.ok();
  } catch (err) {
    const consecutiveFailures = await hb.fail(err instanceof Error ? err.message : String(err));
    getLogger().error({ err, consecutiveFailures }, `${label} cycle failed`);
  }
}
