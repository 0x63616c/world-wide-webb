/**
 * Seam-proof test for the S2 cron-run seam (Track C). Proves the generic
 * dispatcher is a REAL invocation path, not just a collection assertion:
 * imports `runCron` from cron-run.ts, mocks the guest-wifi feature's db so no
 * real DB is touched, dispatches "guest-wifi-purge" through the generated
 * cron-handlers.gen.ts barrel, and asserts the purge path actually ran.
 *
 * Mirrors apps/worker/src/__tests__/jobs-seam.test.ts (the S1 pattern).
 */
import { describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  deleteCalls: 0,
}));

vi.mock("@features/guest-wifi/db", () => ({
  db: {
    delete: () => {
      dbMock.deleteCalls++;
      return {
        where: () => Promise.resolve({ rowCount: 0 }),
      };
    },
  },
}));

import { runCron } from "../cron-run";

describe("S2 cron-run seam", () => {
  it("dispatches a known cron name through the generated handler barrel", async () => {
    dbMock.deleteCalls = 0;

    await runCron("guest-wifi-purge");

    // Proves the collected cron actually RAN through the generated barrel +
    // generic dispatcher: purgePortalData's delete() fired against the
    // mocked guest-wifi db.
    expect(dbMock.deleteCalls).toBe(1);
  });

  it("rejects an unknown cron name", async () => {
    await expect(runCron("not-a-real-cron")).rejects.toThrow(/unknown cron/);
  });

  it("rejects a missing cron name", async () => {
    await expect(runCron(undefined)).rejects.toThrow(/no cron name given/);
  });
});
