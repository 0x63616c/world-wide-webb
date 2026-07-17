// Pure placement resolver: merges saved board_tile_placement rows (Task 3/4,
// server-side) over the TILE_REGISTRY defaults, then resolves any collision a
// defaulted tile lands in via row-major scanline. No React, no network , the
// caller (Board) feeds this the tRPC-fetched saved rows and renders `tiles`.
//
// Semantics (binding, see task-5-brief.md):
//   - A saved row wins over the registry default for that tile id, and is
//     trusted as-is (no collision check against it).
//   - Saved rows for ids not in the registry are ignored (pruned server-side
//     on next save; this resolver just skips them defensively).
//   - Resolution order is registry order, but ALL saved-position tiles are
//     placed before ANY defaulted tile scanlines , so a moved tile can never
//     be displaced by another tile falling back to its default.
//   - A defaulted tile whose default position collides with an
//     already-resolved tile scanlines row-major from that default position,
//     wrapping through the whole inner world (wall ring excluded), for the
//     first slot the tile fits into fully with no overlap.
//   - A tile that genuinely finds no slot (unreachable given real registry
//     sizes; only reachable via the tiny synthetic fixtures in the test) is
//     reported in `unplaced` and dropped from `tiles`.
import { WORLD_COLS, WORLD_ROWS } from "./grid-constants";
import { TILE_REGISTRY, type TileRegistryEntry } from "./tile-registry";

export type { TileRegistryEntry };

export type TilePlacement = {
  tileId: string;
  worldCol: number;
  worldRow: number;
};

export type ResolvedLayout = {
  tiles: (TileRegistryEntry & { worldCol: number; worldRow: number })[];
  unplaced: string[];
};

// Thickness (in cells) of the decorative wall ring on every edge, mirroring
// placeholder-tiles.ts's WALL_THICKNESS , the inner world tiles may occupy is
// the world inset by this much on all sides. Not exported from grid-constants,
// so re-declared here; kept in sync by the shared value (2) both files use.
const WALL_THICKNESS = 2;

export type WorldConfig = {
  worldCols: number;
  worldRows: number;
  wallThickness: number;
};

const DEFAULT_WORLD_CONFIG: WorldConfig = {
  worldCols: WORLD_COLS,
  worldRows: WORLD_ROWS,
  wallThickness: WALL_THICKNESS,
};

type Rect = { worldCol: number; worldRow: number; cols: number; rows: number };

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.worldCol < b.worldCol + b.cols &&
    a.worldCol + a.cols > b.worldCol &&
    a.worldRow < b.worldRow + b.rows &&
    a.worldRow + a.rows > b.worldRow
  );
}

function fitsInner(rect: Rect, world: WorldConfig): boolean {
  const colStart = world.wallThickness;
  const rowStart = world.wallThickness;
  const colEnd = world.worldCols - world.wallThickness; // exclusive
  const rowEnd = world.worldRows - world.wallThickness; // exclusive
  return (
    rect.worldCol >= colStart &&
    rect.worldRow >= rowStart &&
    rect.worldCol + rect.cols <= colEnd &&
    rect.worldRow + rect.rows <= rowEnd
  );
}

// Row-major scanline for the first slot `size` fits into with no overlap
// against `placed`, starting from (defaultCol, defaultRow) and wrapping
// through the whole inner world (wall ring excluded). Returns undefined if
// genuinely no slot exists (every valid position collides).
function scanlineSlot(
  size: { cols: number; rows: number },
  defaultCol: number,
  defaultRow: number,
  placed: Rect[],
  world: WorldConfig,
): { worldCol: number; worldRow: number } | undefined {
  const colStart = world.wallThickness;
  const rowStart = world.wallThickness;
  const colEnd = world.worldCols - world.wallThickness - size.cols; // last valid col, inclusive
  const rowEnd = world.worldRows - world.wallThickness - size.rows; // last valid row, inclusive
  if (colEnd < colStart || rowEnd < rowStart) return undefined;

  // Enumerate every valid top-left in row-major order (row asc, col asc), then
  // rotate the sequence to start at the first position >= (defaultRow,
  // defaultCol) so the scan begins at (or just past) the tile's own default.
  const positions: { worldCol: number; worldRow: number }[] = [];
  for (let row = rowStart; row <= rowEnd; row++) {
    for (let col = colStart; col <= colEnd; col++) {
      positions.push({ worldCol: col, worldRow: row });
    }
  }
  if (positions.length === 0) return undefined;

  let startIndex = positions.findIndex(
    (p) => p.worldRow > defaultRow || (p.worldRow === defaultRow && p.worldCol >= defaultCol),
  );
  if (startIndex === -1) startIndex = 0;

  for (let i = 0; i < positions.length; i++) {
    const pos = positions[(startIndex + i) % positions.length];
    const candidate: Rect = { worldCol: pos.worldCol, worldRow: pos.worldRow, cols: size.cols, rows: size.rows };
    if (!fitsInner(candidate, world)) continue;
    if (placed.some((p) => overlaps(p, candidate))) continue;
    return pos;
  }
  return undefined;
}

// Merge saved placements over registry defaults, resolving collisions via
// scanline. `registry` and `world` default to the real board and only exist
// as a seam for tests exercising the genuinely-no-slot path.
export function resolveLayout(
  saved: TilePlacement[],
  registry: TileRegistryEntry[] = TILE_REGISTRY,
  world: WorldConfig = DEFAULT_WORLD_CONFIG,
): ResolvedLayout {
  const savedById = new Map<string, TilePlacement>();
  for (const row of saved) savedById.set(row.tileId, row);

  const placed: Rect[] = [];
  const tiles: (TileRegistryEntry & { worldCol: number; worldRow: number })[] = [];
  const unplaced: string[] = [];

  // Pass 1: every registry tile with a saved row, in registry order. Saved
  // positions are trusted as-is , no collision check , so a moved tile can
  // never be bumped by a defaulted tile placed afterward.
  const defaulted: TileRegistryEntry[] = [];
  for (const entry of registry) {
    const savedRow = savedById.get(entry.id);
    if (!savedRow) {
      defaulted.push(entry);
      continue;
    }
    const resolved = { ...entry, worldCol: savedRow.worldCol, worldRow: savedRow.worldRow };
    tiles.push(resolved);
    placed.push(resolved);
  }

  // Pass 2: registry tiles without a saved row, defaulting to their registry
  // position, scanlining off it if that position is already occupied.
  for (const entry of defaulted) {
    const defaultRect: Rect = {
      worldCol: entry.worldCol,
      worldRow: entry.worldRow,
      cols: entry.cols,
      rows: entry.rows,
    };
    const collides = placed.some((p) => overlaps(p, defaultRect));
    if (!collides && fitsInner(defaultRect, world)) {
      const resolved = { ...entry, worldCol: entry.worldCol, worldRow: entry.worldRow };
      tiles.push(resolved);
      placed.push(resolved);
      continue;
    }

    const slot = scanlineSlot(entry, entry.worldCol, entry.worldRow, placed, world);
    if (!slot) {
      unplaced.push(entry.id);
      continue;
    }
    const resolved = { ...entry, worldCol: slot.worldCol, worldRow: slot.worldRow };
    tiles.push(resolved);
    placed.push(resolved);
  }

  return { tiles, unplaced };
}
