/**
 * Tests for the frontend-log retention purge. `frontend_log` is append-only
 * device debug logs, so it needs a hard 30-day cutoff on `ts` (capture time).
 * The purge runs from the daily one-shot CronJob (never a worker loop) and
 * deletes in batches, so the things worth pinning are the retention constant and
 * the batch loop's termination + accumulation behaviour.
 */
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import type * as schema from "../db/schema";
import {
  FRONTEND_LOG_RETENTION_MS,
  frontendLogCutoff,
  logShouldPurge,
  MAX_BATCHES,
  purgeFrontendLogs,
} from "../services/frontend-log-purge-service";

const asDb = (fake: unknown) => fake as unknown as NodePgDatabase<typeof schema>;

/** A fake drizzle db whose `execute` returns the next rowCount from a queue. */
function makeFakeDb(rowCounts: Array<number | null>) {
  const calls: unknown[] = [];
  let i = 0;
  const db = {
    execute(query: unknown) {
      calls.push(query);
      const rowCount = i < rowCounts.length ? rowCounts[i] : 0;
      i++;
      return Promise.resolve({ rowCount });
    },
  };
  return { db, calls };
}

describe("frontend-log retention constants", () => {
  it("keeps 30 days of logs", () => {
    expect(FRONTEND_LOG_RETENTION_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("cuts 30 days back from the injected clock", () => {
    const now = new Date(Date.UTC(2026, 0, 31));
    expect(frontendLogCutoff(now)).toEqual(new Date(Date.UTC(2026, 0, 1)));
  });
});

describe("logShouldPurge", () => {
  const now = new Date(Date.UTC(2026, 0, 31));

  it("purges a row captured before the cutoff", () => {
    expect(logShouldPurge({ ts: new Date(Date.UTC(2025, 11, 25)) }, now)).toBe(true);
  });

  it("keeps a row captured after the cutoff", () => {
    expect(logShouldPurge({ ts: new Date(Date.UTC(2026, 0, 15)) }, now)).toBe(false);
  });

  it("keeps a row captured exactly at the cutoff (strict less-than)", () => {
    expect(logShouldPurge({ ts: frontendLogCutoff(now) }, now)).toBe(false);
  });
});

describe("purgeFrontendLogs", () => {
  it("stops on the first empty batch and accumulates the deletes", async () => {
    const { db, calls } = makeFakeDb([20_000, 5, 0]);
    const result = await purgeFrontendLogs(asDb(db), new Date());
    expect(result).toEqual({ logs: 20_005, truncated: false });
    expect(calls.length).toBe(3);
  });

  it("returns zero when nothing matches the cutoff", async () => {
    const { db, calls } = makeFakeDb([0]);
    const result = await purgeFrontendLogs(asDb(db), new Date());
    expect(result).toEqual({ logs: 0, truncated: false });
    expect(calls.length).toBe(1);
  });

  it("treats a null rowCount as zero (driver may omit it)", async () => {
    const { db } = makeFakeDb([null]);
    const result = await purgeFrontendLogs(asDb(db), new Date());
    expect(result).toEqual({ logs: 0, truncated: false });
  });

  it("caps batches and reports the remaining backlog", async () => {
    // Every batch comes back full, so the loop only ends at the cap.
    const { db, calls } = makeFakeDb(new Array(MAX_BATCHES).fill(1));
    const result = await purgeFrontendLogs(asDb(db), new Date());
    expect(result.truncated).toBe(true);
    expect(result.logs).toBe(MAX_BATCHES);
    expect(calls.length).toBe(MAX_BATCHES);
  });
});
