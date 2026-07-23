import { getLogger } from "@www/logger";

import type { IntegrationSyncStore } from "./store";

/**
 * Per-integration liveness + failure-streak recorder (www-355t.9), backed by an
 * `IntegrationSyncStore`. `consecutiveFailures` is a real streak: reset to 0 on
 * success, prior value + 1 on error.
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

export function heartbeat(
  store: IntegrationSyncStore,
  integrationId: string,
): IntegrationHeartbeat {
  return {
    async ok() {
      await store.recordOk(integrationId);
    },
    async fail(error: string) {
      return store.recordFail(integrationId, error);
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
