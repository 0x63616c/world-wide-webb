import { describe, expect, it } from "vitest";

import {
  getBoardLayout,
  type Placement,
  placementSchema,
  saveBoardLayout,
} from "./board-layout-service";

// ─── minimal in-memory db harness (mirrors the mock-db pattern used by
// src/__tests__/queue.test.ts: a plain object implementing only the drizzle
// query-builder surface this service actually calls) ───────────────────────

type Row = Placement & { updatedAtUtc: Date };

type MockDb = {
  select: () => { from: (table: unknown) => Promise<Row[]> };
  transaction: (fn: (tx: MockDb) => Promise<void>) => Promise<void>;
  delete: (table: unknown) => Promise<void>;
  insert: (table: unknown) => { values: (vals: Row[]) => Promise<void> };
};

function createMockDb() {
  let rows: Row[] = [];

  const db: MockDb = {
    select: () => ({
      from: (_table: unknown) => Promise.resolve(rows),
    }),
    transaction: async (fn: (tx: MockDb) => Promise<void>) => {
      await fn(db);
    },
    delete: (_table: unknown) => {
      rows = [];
      return Promise.resolve();
    },
    insert: (_table: unknown) => ({
      values: (vals: Row[]) => {
        rows.push(...vals);
        return Promise.resolve();
      },
    }),
  };

  // biome-ignore lint: test harness stands in for NodePgDatabase<typeof schema>
  return db as any;
}

describe("board-layout-service", () => {
  it("returns empty placements + null revision on fresh table", async () => {
    const db = createMockDb();
    const layout = await getBoardLayout(db);
    expect(layout.placements).toEqual([]);
    expect(layout.revision).toBeNull();
  });

  it("save replaces the whole layout atomically and bumps revision", async () => {
    const db = createMockDb();
    await saveBoardLayout(db, [{ tileId: "tile_clock", worldCol: 26, worldRow: 27 }]);
    const after = await saveBoardLayout(db, [{ tileId: "tile_weath", worldCol: 26, worldRow: 24 }]);
    expect(after.placements).toEqual([{ tileId: "tile_weath", worldCol: 26, worldRow: 24 }]);
    expect(after.revision).not.toBeNull();
  });

  it("rejects duplicate tile ids", async () => {
    const db = createMockDb();
    await expect(
      saveBoardLayout(db, [
        { tileId: "tile_clock", worldCol: 1, worldRow: 1 },
        { tileId: "tile_clock", worldCol: 2, worldRow: 2 },
      ]),
    ).rejects.toThrow(/duplicate/i);
  });

  it("rejects out-of-bounds coords via schema", () => {
    expect(placementSchema.safeParse({ tileId: "tile_x", worldCol: 64, worldRow: 0 }).success).toBe(
      false,
    );
    expect(placementSchema.safeParse({ tileId: "Tile_X", worldCol: 0, worldRow: 0 }).success).toBe(
      false,
    );
  });
});
