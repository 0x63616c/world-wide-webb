// Seconds progress ring traced along the rounded-rect border of the clock tile.
// Path starts at top-center at :00, sweeps clockwise, completes at :60.
// Tile dimensions and padding from board-layout.ts — update there if the grid changes.

import { useRef } from "react";
import { CLOCK_TILE_H, CLOCK_TILE_PADDING, CLOCK_TILE_W, TILE_RX } from "../../lib/board-layout";

const STROKE = 2.5;
// Half-stroke inset so the stroke sits on the visible tile border
const INSET = STROKE / 2;

const W = CLOCK_TILE_W - INSET * 2;
const H = CLOCK_TILE_H - INSET * 2;
const R = TILE_RX - INSET;

// Perimeter of a rounded rectangle: straight edges + full circle from corners
const PERIMETER = 2 * (W - 2 * R) + 2 * (H - 2 * R) + 2 * Math.PI * R;

// Clockwise rounded-rect path starting at top-center.
// Subdivided into 8 segments: 4 arcs (corners) + 4 straight edges.
const PATH =
  // Start at top-center, go right along top edge
  `M ${W / 2 + INSET} ${INSET}` +
  ` H ${W - R + INSET}` +
  // Top-right corner (clockwise: right then down)
  ` A ${R} ${R} 0 0 1 ${W + INSET} ${R + INSET}` +
  // Right edge (down)
  ` V ${H - R + INSET}` +
  // Bottom-right corner
  ` A ${R} ${R} 0 0 1 ${W - R + INSET} ${H + INSET}` +
  // Bottom edge (left)
  ` H ${R + INSET}` +
  // Bottom-left corner
  ` A ${R} ${R} 0 0 1 ${INSET} ${H - R + INSET}` +
  // Left edge (up)
  ` V ${R + INSET}` +
  // Top-left corner
  ` A ${R} ${R} 0 0 1 ${R + INSET} ${INSET}` +
  // Top edge back to top-center
  ` H ${W / 2 + INSET}`;

interface SecondsRingProps {
  seconds: number;
}

export function SecondsRing({ seconds }: SecondsRingProps) {
  // Map [0, 60] → dashoffset from full (nothing drawn) to 0 (fully drawn)
  const progress = Math.min(seconds, 60) / 60;
  const dashoffset = PERIMETER * (1 - progress);

  // Detect the :59→:00 wrap (seconds decreased) so we can drop the transition on
  // that frame — otherwise the ring animates the whole arc backwards to empty.
  const prevSeconds = useRef(seconds);
  const isWrap = seconds < prevSeconds.current;
  prevSeconds.current = seconds;

  return (
    <svg
      data-testid="seconds-ring"
      aria-hidden="true"
      viewBox={`0 0 ${CLOCK_TILE_W} ${CLOCK_TILE_H}`}
      style={{
        position: "absolute",
        // Negative margin escapes the tile's padding box so the SVG covers the full
        // 537x312 tile. Without this the SVG fills only the inner content area
        // (481x256), causing non-uniform X/Y scale factors that distort corner arcs.
        margin: `-${CLOCK_TILE_PADDING}px`,
        width: CLOCK_TILE_W,
        height: CLOCK_TILE_H,
        pointerEvents: "none",
        overflow: "visible",
      }}
    >
      <path
        data-testid="seconds-ring-path"
        d={PATH}
        fill="none"
        stroke="var(--ink-3)"
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeDasharray={String(PERIMETER)}
        strokeDashoffset={String(dashoffset)}
        // 1s linear matches the once-per-second tick so the arc advances at a
        // constant rate (no stutter); the wrap snaps instantly with no transition.
        style={{ transition: isWrap ? "none" : "stroke-dashoffset 1s linear" }}
      />
    </svg>
  );
}
