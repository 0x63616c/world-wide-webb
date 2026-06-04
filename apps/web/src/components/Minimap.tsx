import { useEffect, useRef, useState } from "react";
import { WORLD_H, WORLD_W } from "../lib/grid-constants";

// Longest edge of the minimap's world area, in screen px. The world is scaled by
// a single factor so its proportions (and the tile cluster's) stay true.
const MAX_EXTENT = 150;
// How long after the last pan before the minimap fades away.
const HIDE_DELAY_MS = 1000;

const SCALE = MAX_EXTENT / Math.max(WORLD_W, WORLD_H);
const WORLD_VIEW_W = WORLD_W * SCALE;
const WORLD_VIEW_H = WORLD_H * SCALE;

// Drag past this before a press counts as a scrub (instant follow) rather than a
// click (smooth recenter).
const SCRUB_THRESHOLD = 3;

type View = { left: number; top: number; vw: number; vh: number };
type Rect = { x: number; y: number; w: number; h: number };

/**
 * A figma-style minimap pinned bottom-left. While you pan, it shows the whole
 * world scaled to scale, every tile as a faint block ("everything"), and a bright
 * box marking the slice you're currently looking at. It auto-hides one second
 * after panning stops.
 *
 * Visibility is driven purely off `view` changes: Board produces a fresh `view`
 * object on every (rAF-throttled) scroll frame, so any pan re-shows the map and
 * resets the hide timer. The first change (the layout-effect that centers the
 * board on mount) is skipped so the map doesn't flash on load.
 *
 * Click recenters the viewport (smooth) on that world point; press-and-drag
 * scrubs the view live (instant follow). onJump centers, so we hand it the world
 * coords under the cursor directly.
 */
export function Minimap({
  view,
  tiles,
  onJump,
}: {
  view: View;
  tiles: Rect[];
  onJump: (worldX: number, worldY: number, smooth: boolean) => void;
}) {
  const [visible, setVisible] = useState(false);
  const isFirstView = useRef(true);
  const worldAreaRef = useRef<HTMLDivElement>(null);
  // Scrub state: kept in a ref so live dragging never re-renders the minimap.
  const scrub = useRef({ active: false, moved: false, x: 0, y: 0 });

  useEffect(() => {
    if (isFirstView.current) {
      isFirstView.current = false;
      return;
    }
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), HIDE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [view]);

  // Screen point → world point, via the world-area rect and the fixed SCALE.
  const toWorld = (clientX: number, clientY: number) => {
    const area = worldAreaRef.current;
    if (!area) return null;
    const rect = area.getBoundingClientRect();
    return { x: (clientX - rect.left) / SCALE, y: (clientY - rect.top) / SCALE };
  };

  // The minimap is a DOM descendant of #stage, so without stopPropagation these
  // presses bubble to the stage's own drag-to-pan handler and fight our jumps.
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    scrub.current = { active: true, moved: false, x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = scrub.current;
    if (!s.active) return;
    e.stopPropagation();
    if (!s.moved && Math.hypot(e.clientX - s.x, e.clientY - s.y) < SCRUB_THRESHOLD) return;
    s.moved = true;
    const w = toWorld(e.clientX, e.clientY);
    if (w) onJump(w.x, w.y, false); // instant follow while scrubbing
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const s = scrub.current;
    if (!s.active) return;
    e.stopPropagation();
    s.active = false;
    if (!s.moved) {
      const w = toWorld(e.clientX, e.clientY);
      if (w) onJump(w.x, w.y, true); // plain click → smooth recenter
    }
  };

  return (
    <div
      aria-hidden
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{
        position: "absolute",
        bottom: 12,
        left: 12,
        padding: 6,
        background: "rgba(12, 14, 17, 0.82)",
        border: "1px solid var(--hair)",
        borderRadius: 10,
        backdropFilter: "blur(6px)",
        opacity: visible ? 1 : 0,
        transition: "opacity 0.4s ease",
        // Don't let the invisible map eat clicks in the corner when hidden.
        pointerEvents: visible ? "auto" : "none",
        cursor: "pointer",
        touchAction: "none",
      }}
    >
      <div
        ref={worldAreaRef}
        style={{
          position: "relative",
          width: WORLD_VIEW_W,
          height: WORLD_VIEW_H,
          borderRadius: 4,
          overflow: "hidden",
        }}
      >
        {/* "Everything" — each tile as a faint block, so the viewport box has
            something to be positioned in relation to. */}
        {tiles.map((r) => (
          <div
            key={`${r.x},${r.y}`}
            style={{
              position: "absolute",
              left: r.x * SCALE,
              top: r.y * SCALE,
              width: r.w * SCALE,
              height: r.h * SCALE,
              background: "var(--ink-3)",
              borderRadius: 1,
            }}
          />
        ))}
        {/* The current viewport, proportionally placed within the world. */}
        <div
          style={{
            position: "absolute",
            left: view.left * SCALE,
            top: view.top * SCALE,
            width: view.vw * SCALE,
            height: view.vh * SCALE,
            border: "1px solid var(--acc)",
            background: "var(--acc-dim)",
            borderRadius: 2,
          }}
        />
      </div>
    </div>
  );
}
