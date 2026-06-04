import { QueryErrorResetBoundary } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  BOARD_H,
  BOARD_W,
  GRID_GAP,
  tileWorldRect,
  WORLD_H,
  WORLD_PITCH_H,
  WORLD_PITCH_W,
  WORLD_W,
} from "../lib/grid-constants";
import { TILE_REGISTRY, type TileRegistryEntry } from "../lib/tile-registry";
import { ConnectionLostBanner } from "./ConnectionLostBanner";
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

// Zoom: default is 1 so tiles open at their exact pixel size (the hard
// requirement); pinch / buttons / trackpad explore from there, clamped.
const DEFAULT_ZOOM = 1;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2;
const ZOOM_STEP = 1.2;

// Placement is fixed: precompute every tile's world rect once.
const PLACED = TILE_REGISTRY.map((entry) => ({ entry, rect: tileWorldRect(entry) }));
const CLOCK_RECT = tileWorldRect(
  TILE_REGISTRY.find((t) => t.id === "tile_clock") ?? TILE_REGISTRY[0],
);

// Opening view: scrolled so the Clock sits at viewport center (BOARD_W/H is the
// iPad viewport; the layout effect re-centers with the real client size).
const INITIAL_VIEW = {
  left: (CLOCK_RECT.x + CLOCK_RECT.w / 2) * DEFAULT_ZOOM - BOARD_W / 2,
  top: (CLOCK_RECT.y + CLOCK_RECT.h / 2) * DEFAULT_ZOOM - BOARD_H / 2,
  vw: BOARD_W,
  vh: BOARD_H,
};

// Faint world lattice drawn as a CSS gradient (never per-cell elements), aligned
// to the cell pitch and the board padding so it reads as the grid tiles sit on.
const GRID_BACKDROP: React.CSSProperties = {
  backgroundColor: "var(--bg)",
  backgroundImage:
    `repeating-linear-gradient(90deg, var(--hair) 0 1px, transparent 1px ${WORLD_PITCH_W}px),` +
    `repeating-linear-gradient(0deg, var(--hair) 0 1px, transparent 1px ${WORLD_PITCH_H}px)`,
  backgroundPosition: `${GRID_GAP}px ${GRID_GAP}px`,
};

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

function touchDistance(touches: React.TouchList): number {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

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

/**
 * The pannable, zoomable canvas board. Tiles live on a 48×48 world far larger
 * than the iPad viewport; the existing cluster keeps its exact layout in the
 * bottom-right quadrant and the view opens centered on the Clock at zoom 1.
 *
 * Panning is native scroll (won the pan-lab feel test) plus a desktop mouse-drag
 * shim; only tiles near the viewport are mounted (windowing). Zoom scales the
 * world inside a sizer whose size tracks the zoom, so native scroll — and its
 * momentum — keeps working at every zoom level. Layout is driven entirely by
 * TILE_REGISTRY via tileWorldRect.
 */
export function Board() {
  const stageRef = useRef<HTMLDivElement>(null);
  const [activeModal, setActiveModal] = useState<TileModalEntry | null>(null);
  // Which slice of the world is near the viewport, in screen px (drives windowing).
  const [view, setView] = useState(INITIAL_VIEW);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);

  // Live mirrors / scratch refs so gestures never depend on stale render state.
  const zoomRef = useRef(DEFAULT_ZOOM);
  const pendingScroll = useRef<{ left: number; top: number } | null>(null);
  const drag = useRef({ active: false, moved: false, x: 0, y: 0, sl: 0, st: 0 });
  const pinch = useRef<{ startDist: number; startZoom: number } | null>(null);
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

  // Zoom toward a focal point (screen px within the stage), keeping the world
  // point under the focus fixed. Sets zoom state + the scroll the layout effect
  // will apply once the resized sizer has committed.
  const applyZoom = useCallback((target: number, fx: number, fy: number) => {
    const stage = stageRef.current;
    if (!stage) return;
    const z0 = zoomRef.current;
    const z1 = clampZoom(target);
    if (z1 === z0) return;
    pendingScroll.current = {
      left: (stage.scrollLeft + fx) * (z1 / z0) - fx,
      top: (stage.scrollTop + fy) * (z1 / z0) - fy,
    };
    zoomRef.current = z1;
    setZoom(z1);
  }, []);

  // Open centered on the Clock using the real client size (pre-paint, no flash).
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.scrollLeft = (CLOCK_RECT.x + CLOCK_RECT.w / 2) * zoomRef.current - stage.clientWidth / 2;
    stage.scrollTop = (CLOCK_RECT.y + CLOCK_RECT.h / 2) * zoomRef.current - stage.clientHeight / 2;
    syncView();
  }, [syncView]);

  // After a zoom re-render (sizer resized), apply the focal-preserving scroll.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const p = pendingScroll.current;
    if (!stage || !p) return;
    stage.scrollLeft = p.left;
    stage.scrollTop = p.top;
    pendingScroll.current = null;
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

  // Trackpad / ctrl+wheel zoom — native non-passive listener so preventDefault
  // stops the browser's own page zoom.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = stage.getBoundingClientRect();
      applyZoom(
        zoomRef.current * (1 - e.deltaY * 0.01),
        e.clientX - rect.left,
        e.clientY - rect.top,
      );
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [applyZoom]);

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

  // Two-finger pinch zoom (touch-action keeps one-finger native scroll).
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      pinch.current = { startDist: touchDistance(e.touches), startZoom: zoomRef.current };
    }
  }, []);
  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const p = pinch.current;
      const stage = stageRef.current;
      if (!p || e.touches.length !== 2 || !stage) return;
      e.preventDefault();
      const rect = stage.getBoundingClientRect();
      const fx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      const fy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
      applyZoom(p.startZoom * (touchDistance(e.touches) / p.startDist), fx, fy);
    },
    [applyZoom],
  );
  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length < 2) pinch.current = null;
  }, []);

  const zoomButton = useCallback(
    (dir: 1 | -1) => {
      const stage = stageRef.current;
      const fx = stage ? stage.clientWidth / 2 : BOARD_W / 2;
      const fy = stage ? stage.clientHeight / 2 : BOARD_H / 2;
      applyZoom(zoomRef.current * (dir === 1 ? ZOOM_STEP : 1 / ZOOM_STEP), fx, fy);
    },
    [applyZoom],
  );

  // Visible world rect = scroll/zoom; mount only tiles intersecting it + overscan.
  const wl = view.left / zoom;
  const wt = view.top / zoom;
  const wvw = view.vw / zoom;
  const wvh = view.vh / zoom;
  const visible = PLACED.filter(
    ({ rect }) =>
      rect.x < wl + wvw + OVERSCAN &&
      rect.x + rect.w > wl - OVERSCAN &&
      rect.y < wt + wvh + OVERSCAN &&
      rect.y + rect.h > wt - OVERSCAN,
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
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{
        position: "fixed",
        inset: 0,
        overflow: "auto",
        background: "var(--bg)",
        // Pan is one-finger native scroll; pinch zoom is handled in JS.
        touchAction: "pan-x pan-y",
        cursor: "grab",
        scrollbarWidth: "none",
      }}
    >
      {/* Sizer carries the scaled world size so native scroll extent tracks zoom. */}
      <div style={{ width: WORLD_W * zoom, height: WORLD_H * zoom }}>
        <div
          id="world"
          className="e-root"
          style={{
            position: "relative",
            width: WORLD_W,
            height: WORLD_H,
            transform: `scale(${zoom})`,
            transformOrigin: "top left",
            ...GRID_BACKDROP,
          }}
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
      </div>

      {/* Viewport-level overlays: a fixed ancestor-free layer keeps the banner
          pinned, the zoom controls reachable, and the modal full-screen
          regardless of pan or zoom. */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 200 }}>
        <ConnectionLostBanner />
        <div
          style={{
            position: "absolute",
            right: 18,
            bottom: 18,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            pointerEvents: "auto",
          }}
        >
          <ZoomButton label="Zoom in" onClick={() => zoomButton(1)}>
            +
          </ZoomButton>
          <ZoomButton label="Zoom out" onClick={() => zoomButton(-1)}>
            −
          </ZoomButton>
        </div>
      </div>
      <TileModalHost entry={activeModal} onClose={() => setActiveModal(null)} />
    </div>
  );
}

function ZoomButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      // Don't let the press start a board pan-drag.
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        width: 44,
        height: 44,
        borderRadius: 12,
        background: "var(--tile-2)",
        border: "1px solid var(--hair-2)",
        color: "var(--ink)",
        fontSize: 22,
        lineHeight: 1,
        cursor: "pointer",
        display: "grid",
        placeItems: "center",
      }}
    >
      {children}
    </button>
  );
}
