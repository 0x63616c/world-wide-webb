/**
 * Tests for the weather retention purge. Both weather tables are append-only,
 * so they need a hard 30-day cutoff on `recorded_at`. The purge runs from the
 * daily one-shot CronJob (never a worker loop) and deletes in batches, so the
 * two things worth pinning are the retention constant and the batch loop's
 * termination + accumulation behaviour.
 */
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import type * as schema from "../db/schema";
import {
  MAX_BATCHES_PER_TABLE,
  purgeWeatherData,
  readingShouldPurge,
  WEATHER_RETENTION_MS,
  weatherCutoff,
} from "../services/weather-purge-service";

const asDb = (fake: unknown) => fake as unknown as NodePgDatabase<typeof schema>;

/**
 * A fake drizzle db whose `execute` returns the next rowCount from a queue.
 * Both tables draw from the same queue in call order: weather_reading's batches
 * first, then weather_daily_reading's.
 */
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

describe("weather retention constants", () => {
  it("keeps 30 days of readings", () => {
    expect(WEATHER_RETENTION_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("cuts 30 days back from the injected clock", () => {
    const now = new Date(Date.UTC(2026, 0, 31));
    expect(weatherCutoff(now)).toEqual(new Date(Date.UTC(2026, 0, 1)));
  });
});

describe("readingShouldPurge", () => {
  const now = new Date(Date.UTC(2026, 0, 31));

  it("purges a row recorded before the cutoff", () => {
    expect(readingShouldPurge({ recordedAt: new Date(Date.UTC(2025, 11, 25)) }, now)).toBe(true);
  });

  it("keeps a row recorded after the cutoff", () => {
    expect(readingShouldPurge({ recordedAt: new Date(Date.UTC(2026, 0, 15)) }, now)).toBe(false);
  });

  it("keeps a row recorded exactly at the cutoff (strict less-than)", () => {
    expect(readingShouldPurge({ recordedAt: weatherCutoff(now) }, now)).toBe(false);
  });
});

describe("purgeWeatherData", () => {
  it("stops each table's loop on the first empty batch", async () => {
    // weather_reading: 2 non-empty batches then empty. weather_daily: empty.
    const { db, calls } = makeFakeDb([20_000, 5, 0, 0]);
    const result = await purgeWeatherData(asDb(db), new Date());
    expect(result).toEqual({ readings: 20_005, dailyReadings: 0, truncated: false });
    expect(calls.length).toBe(4);
  });

  it("returns zero when nothing matches the cutoff", async () => {
    const { db, calls } = makeFakeDb([0, 0]);
    const result = await purgeWeatherData(asDb(db), new Date());
    expect(result).toEqual({ readings: 0, dailyReadings: 0, truncated: false });
    expect(calls.length).toBe(2);
  });

  it("treats a null rowCount as zero (driver may omit it)", async () => {
    const { db } = makeFakeDb([null, null]);
    const result = await purgeWeatherData(asDb(db), new Date());
    expect(result).toEqual({ readings: 0, dailyReadings: 0, truncated: false });
  });

  it("caps batches per table and reports the remaining backlog", async () => {
    // Every batch comes back full, so the loop only ends at the cap.
    const { db, calls } = makeFakeDb(new Array(MAX_BATCHES_PER_TABLE * 2).fill(1));
    const result = await purgeWeatherData(asDb(db), new Date());
    expect(result.truncated).toBe(true);
    expect(result.readings).toBe(MAX_BATCHES_PER_TABLE);
    expect(result.dailyReadings).toBe(MAX_BATCHES_PER_TABLE);
    expect(calls.length).toBe(MAX_BATCHES_PER_TABLE * 2);
  });
});
