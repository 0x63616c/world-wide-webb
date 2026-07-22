import { useEffect, useRef, useState } from "react";
import { WORLD_H, WORLD_W } from "../lib/grid-constants";
import { MinimapView } from "./MinimapView";

// Longest edge of the minimap's world area, in screen px. The world is scaled by
// a single factor so its proportions (and the tile cluster's) stay true.
const MAX_EXTENT = 180;
// How long after the last pan before the minimap fades away.
const HIDE_DELAY_MS = 1500;

const SCALE = MAX_EXTENT / Math.max(WORLD_W, WORLD_H);
const WORLD_VIEW_W = WORLD_W * SCALE;
const WORLD_VIEW_H = WORLD_H * SCALE;

// Outer pad around the world area (matches the `padding` on the map container).
const MINIMAP_PAD = 6;
// Distance of the minimap box from the viewport top/left (matches `top`/`left`).
export const MINIMAP_TOP = 12;
export const MINIMAP_LEFT = 12;
// Total rendered width of the minimap box, so the centered-tile label can sit
// directly to its right (matching the hover label) without a magic offset.
export const MINIMAP_WIDTH = WORLD_VIEW_W + MINIMAP_PAD * 2;

// Drag past this before a press counts as a scrub (instant follow) rather than a
// click (smooth recenter).
const SCRUB_THRESHOLD = 3;

type View = { left: number; top: number; vw: number; vh: number };
type Rect = { x: number; y: number; w: number; h: number };
type LabelledRect = Rect & { label: string };

/**
 * A figma-style minimap pinned top-left. While you pan, it shows the whole
 * world scaled to scale, every tile as a faint block ("everything"), and a bright
 * box marking the slice you're currently looking at. It auto-hides 1.5 seconds
 * after panning stops.
 *
 * Visibility is driven off `panSignal`, which Board bumps only for USER-driven
 * scroll frames (see useUserPanSignal): a manual pan re-shows the map and
 * resets the hide timer, while programmatic navigation , the idle-reset glide
 * home, the mount centering , never shows it (www-5teu). 0 = no user pan yet.
 *
 * Click recenters the viewport (smooth) on that world point; press-and-drag
 * scrubs the view live (instant follow). onJump centers, so we hand it the world
 * coords under the cursor directly.
 */
export function Minimap({
  view,
  panSignal,
  tiles,
  ghosts = [],
  onJump,
}: {
  view: View;
  panSignal: number;
  tiles: LabelledRect[];
  // Decorative placeholder tiles, drawn fainter than real tiles so the map shows
  // the populated world without letting the filler read as primary content.
  ghosts?: Rect[];
  onJump: (worldX: number, worldY: number, smooth: boolean) => void;
}) {
  const [visible, setVisible] = useState(false);
  // True while the cursor is over the map: keeps it shown (overriding auto-hide)
  // so you can hover it any time to read tile names, not just right after a pan.
  const [hovering, setHovering] = useState(false);
  // Name of the tile the cursor is over within the map, shown as a label above
  // it. null when the cursor is off any tile (or off the map entirely).
  const [hoveredLabel, setHoveredLabel] = useState<string | null>(null);
  const worldAreaRef = useRef<HTMLDivElement>(null);
  // Scrub state: kept in a ref so live dragging never re-renders the minimap.
  const scrub = useRef({ active: false, moved: false, x: 0, y: 0 });

  useEffect(() => {
    if (panSignal === 0) return;
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), HIDE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [panSignal]);

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
    // Hover label: name the tile under the cursor (works whether or not we're
    // scrubbing, so the label tracks the tile you're dragging the view across).
    const w = toWorld(e.clientX, e.clientY);
    const over = w
      ? tiles.find((t) => w.x >= t.x && w.x <= t.x + t.w && w.y >= t.y && w.y <= t.y + t.h)
      : undefined;
    setHoveredLabel(over?.label ?? null);

    const s = scrub.current;
    if (!s.active) return;
    e.stopPropagation();
    if (!s.moved && Math.hypot(e.clientX - s.x, e.clientY - s.y) < SCRUB_THRESHOLD) return;
    s.moved = true;
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

  // Shown while panning (auto-hide) OR whenever hovered, so it can always be
  // hovered to read tile names , not only in the brief window after a pan.
  const shown = visible || hovering;
  return (
    <MinimapView
      worldViewW={WORLD_VIEW_W}
      worldViewH={WORLD_VIEW_H}
      scale={SCALE}
      tiles={tiles}
      ghosts={ghosts}
      viewportRect={{ x: view.left, y: view.top, w: view.vw, h: view.vh }}
      hoveredLabel={hoveredLabel}
      shown={shown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={() => {
        setHovering(false);
        setHoveredLabel(null);
      }}
      worldAreaRef={worldAreaRef}
    />
  );
}
