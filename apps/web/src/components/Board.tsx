import { QueryErrorResetBoundary } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  BOARD_H,
  BOARD_PADDING,
  BOARD_W,
  CELL_PITCH,
  tileWorldRect,
  WORLD_H,
  WORLD_W,
} from "../lib/grid-constants";
import { TILE_REGISTRY, type TileRegistryEntry } from "../lib/tile-registry";
import { ConnectionLostBanner } from "./ConnectionLostBanner";
import { Minimap } from "./Minimap";
import { getTileModalEntry } from "./tiles/modals/registry";
import { TileModalHost } from "./tiles/modals/TileModalHost";
import type { TileModalEntry } from "./tiles/modals/types";
import { TileBoundary } from "./ui/TileBoundary";

// Interactive descendants a tap may land on (toggles, sliders, the Controls
// "More" button). Taps on these drive the tile's own controls and must NOT also
// open the detail modal; taps anywhere else on the tile open it.
const INTERACTIVE_SELECTOR = 'button, input, a, select, textarea, [role="slider"]';

// Tiles within this many world-px of the viewport edge stay mounted, so panning
// never reveals a blank slot before its tile renders (windowing overscan).
const OVERSCAN = 600;

// Drag past this many px before a mouse press counts as a pan, not a tap — keeps
// click-to-open working while allowing click-drag panning on desktop.
const DRAG_THRESHOLD = 5;

// Placement is fixed: precompute every tile's world rect once. The Clock is
// placed dead center of the world, so the world center is the Clock center.
const PLACED = TILE_REGISTRY.map((entry) => ({ entry, rect: tileWorldRect(entry) }));

// Opening view: scrolled to the world center, which is the Clock center, so the
// board opens with the Clock dead center. The layout effect re-centers with the
// real client size.
const INITIAL_VIEW = {
  left: WORLD_W / 2 - BOARD_W / 2,
  top: WORLD_H / 2 - BOARD_H / 2,
  vw: BOARD_W,
  vh: BOARD_H,
};

// Ambient dot lattice at the (now square) cell pitch, so the canvas texture sits
// on the same grid the tiles do.
const GRID_BACKDROP: React.CSSProperties = {
  backgroundColor: "var(--bg)",
  backgroundImage: "radial-gradient(circle, rgba(255, 255, 255, 0.10) 1.1px, transparent 1.7px)",
  backgroundSize: `${CELL_PITCH}px ${CELL_PITCH}px`,
  backgroundPosition: `${BOARD_PADDING}px ${BOARD_PADDING}px`,
};

// Pairs QueryErrorResetBoundary with TileBoundary via resetKey so a recovered
// query resets the boundary without unmounting or a full page reload.
function BoundedTile({ children }: { children: React.ReactNode }) {
  const [resetKey, setResetKey] = useState(0);
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <TileBoundary
          resetKey={resetKey}
          onReset={() => {
            reset();
            setResetKey((k) => k + 1);
          }}
        >
          {children}
        </TileBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}

// Small live FPS readout pinned top-right, for tuning the canvas feel on-device.
function FpsMeter() {
  const [fps, setFps] = useState(0);
  useEffect(() => {
    let raf = 0;
    let frames = 0;
    let last = performance.now();
    const loop = (now: number) => {
      frames++;
      if (now - last >= 500) {
        setFps(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div
      style={{
        position: "absolute",
        top: 8,
        right: 12,
        fontFamily: "var(--mono)",
        fontSize: 11,
        letterSpacing: "-0.02em",
        color: "var(--ink-3)",
      }}
    >
      {fps} fps
    </div>
  );
}

/**
 * The pannable canvas board. Tiles live on a square world far larger than the
 * iPad viewport, on a square-cell grid; the existing cluster keeps its exact
 * arrangement with the Clock dead center, and the view opens there. Panning is
 * native scroll (won the pan-lab feel test) plus a desktop mouse-drag shim; only
 * tiles near the viewport are mounted (windowing). Zoom is fixed at 1:1 for now.
 *
 * Layout is driven entirely by TILE_REGISTRY via tileWorldRect — adding a tile
 * there places it on the world with no further changes here.
 */
export function Board() {
  const stageRef = useRef<HTMLDivElement>(null);
  const [activeModal, setActiveModal] = useState<TileModalEntry | null>(null);
  // Which slice of the world is near the viewport (drives windowing).
  const [view, setView] = useState(INITIAL_VIEW);

  // Mouse-drag pan state, kept in a ref so dragging never re-renders the board.
  const drag = useRef({ active: false, moved: false, x: 0, y: 0, sl: 0, st: 0 });
  // True for the click immediately after a drag, so the pan doesn't also open a tile.
  const suppressClick = useRef(false);
  const rafRef = useRef(0);

  function openTile(entry: TileRegistryEntry, e: React.MouseEvent<HTMLDivElement>) {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (entry.ownsTap) return;
    if ((e.target as HTMLElement).closest(INTERACTIVE_SELECTOR)) return;
    const modal = getTileModalEntry(entry.id);
    if (modal) setActiveModal(modal);
  }

  // Center the viewport on a world-space point (the minimap calls this on click
  // and during drag-scrub). scrollTo clamps to the scroll range, and each frame
  // of the smooth glide fires onScroll → keeps the minimap alive through it.
  const jumpTo = useCallback((worldX: number, worldY: number, smooth: boolean) => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.scrollTo({
      left: worldX - stage.clientWidth / 2,
      top: worldY - stage.clientHeight / 2,
      behavior: smooth ? "smooth" : "auto",
    });
  }, []);

  const syncView = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    setView({
      left: stage.scrollLeft,
      top: stage.scrollTop,
      vw: stage.clientWidth,
      vh: stage.clientHeight,
    });
  }, []);

  // Open centered on the world center (== Clock center) using the real client
  // size (pre-paint, no flash).
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.scrollLeft = WORLD_W / 2 - stage.clientWidth / 2;
    stage.scrollTop = WORLD_H / 2 - stage.clientHeight / 2;
    syncView();
  }, [syncView]);

  // rAF-throttle scroll → window state so the mounted-tile set tracks the pan
  // without a setState per scroll event.
  const onScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      syncView();
    });
  }, [syncView]);
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  // Desktop mouse-drag-to-pan. Touch is left to native momentum scrolling.
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    const stage = stageRef.current;
    if (!stage) return;
    drag.current = {
      active: true,
      moved: false,
      x: e.clientX,
      y: e.clientY,
      sl: stage.scrollLeft,
      st: stage.scrollTop,
    };
  }, []);
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    const stage = stageRef.current;
    if (!d.active || !stage) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    d.moved = true;
    stage.style.cursor = "grabbing";
    stage.scrollLeft = d.sl - dx;
    stage.scrollTop = d.st - dy;
  }, []);
  const endDrag = useCallback(() => {
    const stage = stageRef.current;
    if (stage) stage.style.cursor = "grab";
    if (drag.current.moved) suppressClick.current = true;
    drag.current.active = false;
  }, []);

  const visible = PLACED.filter(
    ({ rect }) =>
      rect.x < view.left + view.vw + OVERSCAN &&
      rect.x + rect.w > view.left - OVERSCAN &&
      rect.y < view.top + view.vh + OVERSCAN &&
      rect.y + rect.h > view.top - OVERSCAN,
  );

  return (
    <div
      id="stage"
      ref={stageRef}
      onScroll={onScroll}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      style={{
        position: "fixed",
        inset: 0,
        overflow: "auto",
        background: "var(--bg)",
        // Pan is one-finger native scroll; no rubber-band past the world edges.
        touchAction: "pan-x pan-y",
        overscrollBehavior: "none",
        cursor: "grab",
        scrollbarWidth: "none",
      }}
    >
      <div
        id="world"
        className="e-root"
        style={{ position: "relative", width: WORLD_W, height: WORLD_H, ...GRID_BACKDROP }}
      >
        {visible.map(({ entry, rect }) => {
          const { id, component: TileComponent, label } = entry;
          return (
            // Not a real <button>: the tile body contains its own buttons
            // (toggles, sliders, "More"), and nesting interactive elements is
            // invalid. role+tabIndex give the wrapper button semantics while
            // keeping inner controls separately operable.
            // biome-ignore lint/a11y/useSemanticElements: nested interactive content forbids a <button>
            <div
              key={id}
              style={{
                position: "absolute",
                left: rect.x,
                top: rect.y,
                width: rect.w,
                height: rect.h,
                cursor: "pointer",
              }}
              role="button"
              tabIndex={0}
              aria-label={`Open ${label}`}
              onClick={(e) => openTile(entry, e)}
              onKeyDown={(e) => {
                if (entry.ownsTap) return;
                if (e.target !== e.currentTarget) return;
                if (e.key === "Enter" || e.key === " ") {
                  const modal = getTileModalEntry(entry.id);
                  if (!modal) return;
                  e.preventDefault();
                  setActiveModal(modal);
                }
              }}
            >
              <BoundedTile>
                <TileComponent />
              </BoundedTile>
            </div>
          );
        })}
      </div>

      {/* Viewport-level overlays: a fixed ancestor-free layer keeps the banner,
          FPS readout, and modal anchored to the screen regardless of pan. */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 200 }}>
        <ConnectionLostBanner />
        <FpsMeter />
        <Minimap view={view} tiles={PLACED.map((p) => p.rect)} onJump={jumpTo} />
      </div>
      <TileModalHost entry={activeModal} onClose={() => setActiveModal(null)} />
    </div>
  );
}
