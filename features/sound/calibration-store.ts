/**
 * Persisted per-room calibration baselines (the `sound_calibration` table).
 *
 * The store is a small interface so the service layer and tests can run
 * against an in-memory adapter; `pgCalibrationStore` is the production
 * adapter over the feature db. Rows are keyed by the room's HA entity id.
 */
import { inArray } from "drizzle-orm";
import type { CalibrationBaselines } from "./calibration";
import { db } from "./db";
import { soundCalibration } from "./schema";

export interface CalibrationStore {
  /** Every stored baseline, keyed by room id. */
  readAll(): Promise<CalibrationBaselines>;
  /** Insert-or-replace the given baselines; untouched rooms keep theirs. */
  upsertMany(baselines: CalibrationBaselines): Promise<void>;
  /** Drop the rows for these rooms (a missing row = uncalibrated). */
  deleteMany(roomIds: readonly string[]): Promise<void>;
}

export const pgCalibrationStore: CalibrationStore = {
  async readAll() {
    const rows = await db
      .select({ roomId: soundCalibration.roomId, baseline: soundCalibration.baseline })
      .from(soundCalibration);
    return Object.fromEntries(rows.map((r) => [r.roomId, r.baseline]));
  },
  async upsertMany(baselines) {
    const now = new Date();
    for (const [roomId, baseline] of Object.entries(baselines)) {
      await db
        .insert(soundCalibration)
        .values({ roomId, baseline, updatedAtUtc: now })
        .onConflictDoUpdate({
          target: soundCalibration.roomId,
          set: { baseline, updatedAtUtc: now },
        });
    }
  },
  async deleteMany(roomIds) {
    if (roomIds.length === 0) return;
    await db.delete(soundCalibration).where(inArray(soundCalibration.roomId, [...roomIds]));
  },
};

/** In-memory adapter for tests. */
export function createMemoryCalibrationStore(
  initial: CalibrationBaselines = {},
): CalibrationStore & { snapshot(): CalibrationBaselines } {
  const state: CalibrationBaselines = { ...initial };
  return {
    async readAll() {
      return { ...state };
    },
    async upsertMany(baselines) {
      Object.assign(state, baselines);
    },
    async deleteMany(roomIds) {
      for (const id of roomIds) delete state[id];
    },
    snapshot() {
      return { ...state };
    },
  };
}
