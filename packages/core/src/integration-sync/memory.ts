import type { IntegrationSyncRow, IntegrationSyncStore } from "./store";

/** An in-memory `IntegrationSyncStore`: a `Map<integrationId, row>` for tests and local dev. */
export function createInMemoryIntegrationSyncStore(): IntegrationSyncStore {
  const rows = new Map<string, IntegrationSyncRow>();

  function write(integrationId: string, error: string | null, consecutiveFailures: number): void {
    const now = new Date();
    rows.set(integrationId, {
      integrationId,
      lastPolledAtUtc: now,
      lastError: error,
      consecutiveFailures,
      updatedAtUtc: now,
    });
  }

  return {
    async read(integrationId) {
      const row = rows.get(integrationId);
      return row ? structuredClone(row) : null;
    },

    async recordOk(integrationId) {
      write(integrationId, null, 0);
    },

    async recordFail(integrationId, error) {
      const consecutiveFailures = (rows.get(integrationId)?.consecutiveFailures ?? 0) + 1;
      write(integrationId, error, consecutiveFailures);
      return consecutiveFailures;
    },
  };
}
