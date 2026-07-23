import type { integrationSyncStatus } from "./schema";

export type IntegrationSyncRow = typeof integrationSyncStatus.$inferSelect;

/**
 * Persistence surface for per-integration liveness. The ONLY code that touches
 * the `integration_sync_status` table. A single in-process poller runs ticks
 * sequentially, so the read-modify-write in `recordFail` is race-free. DB
 * failures always throw (mirroring `DeviceStateStore`'s contract).
 */
export interface IntegrationSyncStore {
  /** Read the row for an integration, or null when it has never reported. */
  read(integrationId: string): Promise<IntegrationSyncRow | null>;
  /** Record a successful cycle: fresh poll time, no error, streak reset to 0. */
  recordOk(integrationId: string): Promise<void>;
  /** Record a failed cycle; returns the NEW consecutive-failure streak. */
  recordFail(integrationId: string, error: string): Promise<number>;
}
