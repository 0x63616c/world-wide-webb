// Single source of truth for the board grid.
// Imported by Board, tile-registry, the Minimap, and Storybook.
//
// The board is a SQUARE-cell grid: 12 columns × 9 rows. A 12×6 grid in the
// 1366×1000 viewport made cells taller than wide (167 tall vs 114 wide), which
// propagated into a taller-than-wide world and a backdrop grid that could never
// be both square and tile-aligned. Making the cell square fixes all of it. The
// cell keeps the old column width, so tile WIDTHS are unchanged and only heights
// grow ~3% (e.g. the Clock goes from 5×2 to 5×3 cells).
// The wall-panel TARGET dimensions (the physical iPad Pro panel). Two real uses:
// (1) CELL below is sized to fill BOARD_W, so this sets the absolute tile pixel
// size; (2) Storybook frames stories at this size. The LIVE board does NOT crop
// to this — its stage is position:fixed/inset:0 (full window), so on a larger
// screen you simply see more of the world. Not a viewport clip. See Board.tsx.
export const BOARD_W = 1366;
export const BOARD_H = 1000;
export const GRID_COLS = 12;
export const GRID_ROWS = 9;
const GRID_GAP = 18;
// Edge margin equals GRID_GAP so the gap from the board edge to the first/last
// card is identical to the gutter between any two cards.
const BOARD_PADDING = GRID_GAP;

// One square cell, sized to the old column width so tile widths never change.
const CELL = (BOARD_W - 2 * BOARD_PADDING - (GRID_COLS - 1) * GRID_GAP) / GRID_COLS;
const CELL_PITCH = CELL + GRID_GAP;

// Exact pixel footprint of a tile spanning `cols`×`rows` square cells. Width and
// height share the same cell, so a tile's aspect is purely its span ratio.
export function tilePixelSize(cols: number, rows: number): { width: number; height: number } {
  return {
    width: cols * CELL + (cols - 1) * GRID_GAP,
    height: rows * CELL + (rows - 1) * GRID_GAP,
  };
}

// ===== Pannable one-world canvas (square) ===================================
// The world is a large square canvas (WORLD_COLS×WORLD_ROWS cells) that you pan
// around; the window shows whatever slice fits (~BOARD_W×BOARD_H on the panel,
// more on a bigger screen — no crop). There is no separate "viewport grid": real
// tiles are placed ANYWHERE in this world at any size (world-cell coords on each
// registry entry), and the decorative bento + WALL_THICKNESS-cell wall ring
// (placeholder-tiles.ts) regenerate to fill every remaining cell around them.
// 64×64 gives generous room to move/add tiles without re-packing anything.
export const WORLD_COLS = 64;
export const WORLD_ROWS = 64;
export const WORLD_W = 2 * BOARD_PADDING + WORLD_COLS * CELL + (WORLD_COLS - 1) * GRID_GAP;
export const WORLD_H = 2 * BOARD_PADDING + WORLD_ROWS * CELL + (WORLD_ROWS - 1) * GRID_GAP;

// World-pixel rect for a 0-indexed world-cell span. The lattice origin and pitch
// are the single source of truth, so both real tiles and decorative placeholders
// resolve through here. Width/height equal tilePixelSize by construction.
export function worldCellRect(
  col: number,
  row: number,
  cols: number,
  rows: number,
): { x: number; y: number; w: number; h: number } {
  const { width, height } = tilePixelSize(cols, rows);
  return {
    x: BOARD_PADDING + col * CELL_PITCH,
    y: BOARD_PADDING + row * CELL_PITCH,
    w: width,
    h: height,
  };
}

// World-pixel rect for a registry tile. Tiles now carry their world-cell position
// directly (worldCol/worldRow, 0-indexed), so this is a thin pass-through — no
// cluster offset, no central-anchor assumption. Move a tile by editing its coords.
export function tileWorldRect(t: {
  worldCol: number;
  worldRow: number;
  cols: number;
  rows: number;
}): { x: number; y: number; w: number; h: number } {
  return worldCellRect(t.worldCol, t.worldRow, t.cols, t.rows);
}
