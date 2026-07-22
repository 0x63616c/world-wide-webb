import { getLogger } from "@www/logger";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";

import type * as schema from "../db/schema";
import { boardTilePlacement } from "../db/schema";

// ─── shape + validation ────────────────────────────────────────────────────────

// A single tile's position on the 64x64 world grid. The server does not know
// tile footprints (width/height) — geometry validity (overlap, out-of-bounds
// spans) is owned by the client; the server only enforces per-placement bounds
// and tile-id uniqueness.
export const placementSchema = z.object({
  tileId: z.string().regex(/^tile_[a-z0-9]+$/),
  worldCol: z.number().int().min(0).max(63),
  worldRow: z.number().int().min(0).max(63),
});

export const layoutSchema = z.object({
  placements: z.array(placementSchema),
  // Max updated_at_utc across all placement rows, as an ISO string. null when
  // the table is empty. Clients diff this against their last-seen revision to
  // skip no-op re-renders.
  revision: z.string().nullable(),
});

export type Placement = z.infer<typeof placementSchema>;
export type Layout = z.infer<typeof layoutSchema>;

type Database = NodePgDatabase<typeof schema>;

// ─── public API ──────────────────────────────────────────────────────────────

/** Read the whole board layout: every tile placement plus a revision marker. */
export async function getBoardLayout(db: Database): Promise<Layout> {
  const rows = await db.select().from(boardTilePlacement);

  const placements = rows.map((row) => ({
    tileId: row.tileId,
    worldCol: row.worldCol,
    worldRow: row.worldRow,
  }));

  let latest: Date | null = null;
  for (const row of rows) {
    if (latest === null || row.updatedAtUtc > latest) latest = row.updatedAtUtc;
  }
  const revision = latest === null ? null : latest.toISOString();

  return layoutSchema.parse({ placements, revision });
}

/**
 * Replace the entire board layout atomically: delete every existing placement
 * row and bulk-insert the new set in one transaction, then return the fresh
 * layout. Rejects duplicate tile ids before touching the DB.
 */
export async function saveBoardLayout(db: Database, placements: Placement[]): Promise<Layout> {
  const parsed = placements.map((placement) => placementSchema.parse(placement));

  const seen = new Set<string>();
  for (const { tileId } of parsed) {
    if (seen.has(tileId)) {
      throw new Error(`saveBoardLayout: duplicate tile id "${tileId}" in placements`);
    }
    seen.add(tileId);
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.delete(boardTilePlacement);
    if (parsed.length > 0) {
      await tx.insert(boardTilePlacement).values(
        parsed.map((placement) => ({
          tileId: placement.tileId,
          worldCol: placement.worldCol,
          worldRow: placement.worldRow,
          updatedAtUtc: now,
        })),
      );
    }
  });

  getLogger().info({ count: parsed.length }, "saveBoardLayout: layout persisted");
  return getBoardLayout(db);
}
