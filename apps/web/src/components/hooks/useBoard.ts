/** Pure windowing filter for the board's fixed viewport. */

// ─── types ────────────────────────────────────────────────────────────────────

export type BoardView = { left: number; top: number; vw: number; vh: number };

type Rect = { x: number; y: number; w: number; h: number };

// ─── getVisibleTiles ──────────────────────────────────────────────────────────

const OVERSCAN = 600;

/**
 * Pure windowing filter. Returns the subset of `cells` whose rects overlap the
 * fixed viewport (plus OVERSCAN px on each edge).
 */
export function getVisibleTiles<T extends { rect: Rect }>(cells: T[], view: BoardView): T[] {
  return cells.filter(
    ({ rect }) =>
      rect.x < view.left + view.vw + OVERSCAN &&
      rect.x + rect.w > view.left - OVERSCAN &&
      rect.y < view.top + view.vh + OVERSCAN &&
      rect.y + rect.h > view.top - OVERSCAN,
  );
}
