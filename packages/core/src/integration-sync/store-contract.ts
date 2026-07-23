import { describe, expect, it } from "vitest";

import type { IntegrationSyncStore } from "./store";

/**
 * Behavior contract every `IntegrationSyncStore` implementation must satisfy. Run
 * it against each adapter via `runIntegrationSyncStoreContract(() => createAdapter())`.
 */
export function runIntegrationSyncStoreContract(
  makeStore: () => Promise<IntegrationSyncStore> | IntegrationSyncStore,
): void {
  async function freshStore(): Promise<IntegrationSyncStore> {
    return await makeStore();
  }

  describe("read", () => {
    it("returns null for an integration that has never reported", async () => {
      const store = await freshStore();
      expect(await store.read("never-seen")).toBeNull();
    });
  });

  describe("recordOk", () => {
    it("writes a row with no error and a zero streak, and a fresh poll time", async () => {
      const store = await freshStore();
      const before = Date.now();

      await store.recordOk("light-enforcer");

      const row = await store.read("light-enforcer");
      expect(row).not.toBeNull();
      expect(row?.integrationId).toBe("light-enforcer");
      expect(row?.lastError).toBeNull();
      expect(row?.consecutiveFailures).toBe(0);
      expect((row?.lastPolledAtUtc as Date).getTime()).toBeGreaterThanOrEqual(before);
    });

    it("resets the streak and clears the error after a run of failures", async () => {
      const store = await freshStore();
      await store.recordFail("weather", "boom");
      await store.recordFail("weather", "boom again");

      await store.recordOk("weather");

      const row = await store.read("weather");
      expect(row?.consecutiveFailures).toBe(0);
      expect(row?.lastError).toBeNull();
    });
  });

  describe("recordFail", () => {
    it("treats a missing prior row as streak 0 (first failure -> 1)", async () => {
      const store = await freshStore();

      const streak = await store.recordFail("weather", "boom");

      expect(streak).toBe(1);
      const row = await store.read("weather");
      expect(row?.consecutiveFailures).toBe(1);
      expect(row?.lastError).toBe("boom");
    });

    it("increments the prior streak and returns the new value", async () => {
      const store = await freshStore();
      await store.recordFail("weather", "first");

      const streak = await store.recordFail("weather", "second");

      expect(streak).toBe(2);
      const row = await store.read("weather");
      expect(row?.consecutiveFailures).toBe(2);
      expect(row?.lastError).toBe("second");
    });

    it("continues the streak across a fresh recordFail after an ok reset", async () => {
      const store = await freshStore();
      await store.recordFail("weather", "a");
      await store.recordFail("weather", "b");
      await store.recordOk("weather");

      const streak = await store.recordFail("weather", "c");

      expect(streak).toBe(1);
    });

    it("tracks streaks per integration independently", async () => {
      const store = await freshStore();
      await store.recordFail("a", "x");
      await store.recordFail("a", "y");

      const bStreak = await store.recordFail("b", "z");

      expect(bStreak).toBe(1);
      expect((await store.read("a"))?.consecutiveFailures).toBe(2);
    });
  });
}
