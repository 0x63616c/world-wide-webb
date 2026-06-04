// Single source of truth for the fixed 1366×1000 board grid.
// Imported by Board, tile-registry, board-layout, and the Storybook decorator.
//
// 1366×1000 is the iPad's REAL usable viewport as a fullscreen web app (it
// reports innerHeight 1000, not the nominal 1024 — ~24px is unaccounted for even
// in standalone mode). See cc-* "re-explore actual iPad screen size" — this is a
// best-fit placeholder until that's resolved.
export const BOARD_W = 1366;
export const BOARD_H = 1000;
export const GRID_COLS = 12;
export const GRID_ROWS = 6;
export const GRID_GAP = 18;
// Edge margin equals GRID_GAP so the gap from the board edge to the first/last
// card is identical to the gutter between any two cards — one uniform spacing
// scale across the whole board.
export const BOARD_PADDING = GRID_GAP;

// One grid cell's pixel size, derived from the board box minus padding and gaps.
// A tile spanning N cols/rows occupies N cells plus the (N-1) gaps between them.
const CELL_W = (BOARD_W - 2 * BOARD_PADDING - (GRID_COLS - 1) * GRID_GAP) / GRID_COLS;
const CELL_H = (BOARD_H - 2 * BOARD_PADDING - (GRID_ROWS - 1) * GRID_GAP) / GRID_ROWS;

// Exact pixel footprint of a tile spanning `cols`×`rows` cells on the board.
// This is the true size the CSS grid gives the tile in production, so Storybook
// can render the tile alone at production size without drawing the whole board.
export function tilePixelSize(cols: number, rows: number): { width: number; height: number } {
  return {
    width: cols * CELL_W + (cols - 1) * GRID_GAP,
    height: rows * CELL_H + (rows - 1) * GRID_GAP,
  };
}

// ===== Pannable world =======================================================
// BOARD_W/BOARD_H is the VIEWPORT (the iPad crop). The world is a larger canvas
// you pan/zoom around: the 12×6 board subdivided ×2 into a 48×48 lattice at half
// the cell pitch (gap unchanged). A tile spanning N board-cells spans 2N world-
// cells, so WORLD_CELL = (CELL − GAP) / 2 keeps its rendered pixel size identical
// — the existing tiles never move relative to each other or change size.
export const SUBDIVIDE = 2;
export const WORLD_COLS = 48;
export const WORLD_ROWS = 48;

export const WORLD_CELL_W = (CELL_W - GRID_GAP) / SUBDIVIDE;
export const WORLD_CELL_H = (CELL_H - GRID_GAP) / SUBDIVIDE;
export const WORLD_PITCH_W = WORLD_CELL_W + GRID_GAP;
export const WORLD_PITCH_H = WORLD_CELL_H + GRID_GAP;

export const WORLD_W = 2 * BOARD_PADDING + WORLD_COLS * WORLD_CELL_W + (WORLD_COLS - 1) * GRID_GAP;
export const WORLD_H = 2 * BOARD_PADDING + WORLD_ROWS * WORLD_CELL_H + (WORLD_ROWS - 1) * GRID_GAP;

// Cells the existing 12×6 cluster occupies once doubled, and the offset that
// parks it flush in the bottom-right quadrant of the 48×48 world.
const CLUSTER_COLS = GRID_COLS * SUBDIVIDE;
const CLUSTER_ROWS = GRID_ROWS * SUBDIVIDE;
const CLUSTER_COL_OFFSET = WORLD_COLS - CLUSTER_COLS;
const CLUSTER_ROW_OFFSET = WORLD_ROWS - CLUSTER_ROWS;

// World-pixel rect for a registry tile: its board grid position doubled and
// shifted into the bottom-right cluster. Width/height equal tilePixelSize by
// construction, so a tile renders pixel-identically to the old fixed board.
export function tileWorldRect(t: {
  colStart: number;
  rowStart: number;
  cols: number;
  rows: number;
}): { x: number; y: number; w: number; h: number } {
  const c0 = (t.colStart - 1) * SUBDIVIDE + CLUSTER_COL_OFFSET;
  const r0 = (t.rowStart - 1) * SUBDIVIDE + CLUSTER_ROW_OFFSET;
  const wc = t.cols * SUBDIVIDE;
  const wr = t.rows * SUBDIVIDE;
  return {
    x: BOARD_PADDING + c0 * WORLD_PITCH_W,
    y: BOARD_PADDING + r0 * WORLD_PITCH_H,
    w: wc * WORLD_CELL_W + (wc - 1) * GRID_GAP,
    h: wr * WORLD_CELL_H + (wr - 1) * GRID_GAP,
  };
}
