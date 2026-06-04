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
import { BENTO_RECTS } from "../lib/placeholder-tiles";
import { TILE_REGISTRY, type TileRegistryEntry } from "../lib/tile-registry";
import { ConnectionLostBanner } from "./ConnectionLostBanner";
import { Minimap } from "./Minimap";
import { PlaceholderTile } from "./PlaceholderTile";
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

// Snap-to-center feel: while a pointer is down (or a fling is still moving) you
// pan freely; once it settles, a critically-damped spring gravitates the nearest
// tile's center to the viewport center. Critically damped = a PD controller
// (the "I" of PID is unwanted here — there's no steady-state disturbance to
// integrate out, it would only add overshoot). Implemented as SmoothDamp (Thomas
// Lowe, Game Programming Gems 4; same as Unity Mathf.SmoothDamp): one smoothTime
// knob, carries velocity so a fling flows into the dock, integrated against real
// dt so the feel is identical at any frame rate.
const SNAP_SMOOTH_TIME = 0.32; // ~seconds to converge; the single feel knob
const SNAP_DEADZONE = 6; // px from centered; below this, don't spring at all
const SNAP_STOP_PX = 0.5; // settled when this close to target...
const SNAP_STOP_VEL = 6; // ...and slower than this (px/s)
const SNAP_MAX_DT = 0.05; // clamp dt so a backgrounded tab doesn't lurch
// Native scrollend fires once momentum settles (Safari 16+, Chrome 114+);
// elsewhere we debounce scroll-idle. Read off window so it isn't treated as a
// type guard that narrows the stage element.
const SUPPORTS_SCROLLEND = typeof window !== "undefined" && "onscrollend" in window;
const SETTLE_IDLE_MS = 140;

// One axis of SmoothDamp. Returns [nextPos, nextVel]. `exp` is the standard
// polynomial approximation of e^-x; the final branch clamps overshoot.
function smoothDamp(
  current: number,
  target: number,
  vel: number,
  smoothTime: number,
  dt: number,
): [number, number] {
  const omega = 2 / smoothTime;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temp = (vel + omega * change) * dt;
  let output = target + (change + temp) * exp;
  let outVel = (vel - omega * temp) * exp;
  if (target - current > 0 === output > target) {
    output = target;
    outVel = 0;
  }
  return [output, outVel];
}

// Placement is fixed: precompute every tile's world rect once. The Clock is
// placed dead center of the world, so the world center is the Clock center.
const PLACED = TILE_REGISTRY.map((entry) => ({ entry, rect: tileWorldRect(entry) }));

type Rect = { x: number; y: number; w: number; h: number };

// Everything the crosshair can center on / snap to: real tiles AND the empty
// bento fill. Both sit on the same world lattice, so for centering they're just
// identified rects — an empty tile under the crosshair highlights and snaps
// exactly like a real one.
const CENTER_TARGETS: { id: string; rect: Rect }[] = [
  ...PLACED.map((p) => ({ id: p.entry.id, rect: p.rect })),
  ...BENTO_RECTS,
];

// The target whose rect contains world point (cx, cy), or undefined in a gap.
function targetAt(cx: number, cy: number) {
  return CENTER_TARGETS.find(
    ({ rect }) => cx >= rect.x && cx <= rect.x + rect.w && cy >= rect.y && cy <= rect.y + rect.h,
  );
}

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

// Faint center crosshair so the viewport's exact middle (which drives the
// centered-tile highlight) is visible. Lives in the fixed overlay, so it always
// marks screen-center regardless of pan. A small "+" with a hollow center reads
// as a marker rather than full-screen rulers.
function CenterCrosshair() {
  const ARM = 12; // px each side of center
  const line = "rgba(255, 255, 255, 0.16)";
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
        width: ARM * 2,
        height: ARM * 2,
      }}
    >
      {/* horizontal arm */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: 0,
          width: "100%",
          height: 1,
          background: line,
          transform: "translateY(-0.5px)",
        }}
      />
      {/* vertical arm */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 0,
          width: 1,
          height: "100%",
          background: line,
          transform: "translateX(-0.5px)",
        }}
      />
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
  // In-flight snap spring: rAF id (nonzero ⇒ WE are scrolling, so the scrollend
  // it emits isn't mistaken for a user settle) plus carried per-axis velocity.
  // px/py are the authoritative FLOAT scroll position the spring integrates on.
  // We can't read stage.scrollLeft back as state: the browser rounds it to whole
  // pixels, so near the target the sub-pixel step rounds away and the spring
  // stalls short of center. Keeping a float and only writing the rounded value
  // out fixes that.
  const spring = useRef({ raf: 0, vx: 0, vy: 0, last: 0, px: 0, py: 0 });
  // Whether a pointer is currently held down (touch or mouse). While held, the
  // user pans freely — no spring engages until they let go.
  const pointerDown = useRef(false);

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

  // Cancel any in-flight snap spring (user reclaimed control, or we're done).
  const cancelSnap = useCallback(() => {
    if (spring.current.raf) cancelAnimationFrame(spring.current.raf);
    spring.current.raf = 0;
  }, []);

  // Spring the stage toward (toLeft, toTop) with a critically-damped SmoothDamp
  // on each axis, integrated against real dt every frame. Carries velocity in
  // `spring`, so re-targeting mid-flight (or a fling's residual speed) stays
  // smooth. Settles when close and slow, then pins exactly to target.
  const springTo = useCallback((toLeft: number, toTop: number) => {
    const stage = stageRef.current;
    if (!stage) return;
    const s = spring.current;
    if (s.raf) cancelAnimationFrame(s.raf);
    s.vx = 0;
    s.vy = 0;
    s.px = stage.scrollLeft; // seed the float from the real position once
    s.py = stage.scrollTop;
    s.last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(SNAP_MAX_DT, (now - s.last) / 1000);
      s.last = now;
      const [nl, vl] = smoothDamp(s.px, toLeft, s.vx, SNAP_SMOOTH_TIME, dt);
      const [nt, vt] = smoothDamp(s.py, toTop, s.vy, SNAP_SMOOTH_TIME, dt);
      s.px = nl; // advance the float; scrollLeft (rounded) is just the output
      s.py = nt;
      s.vx = vl;
      s.vy = vt;
      stage.scrollLeft = nl;
      stage.scrollTop = nt;
      const settled =
        Math.hypot(toLeft - nl, toTop - nt) < SNAP_STOP_PX && Math.hypot(vl, vt) < SNAP_STOP_VEL;
      if (settled) {
        stage.scrollLeft = toLeft;
        stage.scrollTop = toTop;
        s.raf = 0;
      } else {
        s.raf = requestAnimationFrame(step);
      }
    };
    s.raf = requestAnimationFrame(step);
  }, []);

  // On settle (scrolling stopped AND nothing held): gravitate the tile under the
  // crosshair to the viewport center. Reads scroll state live rather than `view`
  // so it's correct the instant the pan stops. Skips when already centered.
  const onSettle = useCallback(() => {
    // Ignore the settle from our own spring, and never fight a held pointer.
    if (spring.current.raf || pointerDown.current || drag.current.active) return;
    const stage = stageRef.current;
    if (!stage) return;
    const cx = stage.scrollLeft + stage.clientWidth / 2;
    const cy = stage.scrollTop + stage.clientHeight / 2;
    const hit = targetAt(cx, cy);
    if (!hit) return; // crosshair over a gap (rare; world is fully tiled) → leave it
    const toLeft = hit.rect.x + hit.rect.w / 2 - stage.clientWidth / 2;
    const toTop = hit.rect.y + hit.rect.h / 2 - stage.clientHeight / 2;
    if (Math.hypot(toLeft - stage.scrollLeft, toTop - stage.scrollTop) < SNAP_DEADZONE) return;
    springTo(toLeft, toTop);
  }, [springTo]);

  // Desktop mouse-drag-to-pan. Touch is left to native momentum scrolling.
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Any grab (touch or mouse) interrupts a running snap so we don't fight it,
      // and marks the pointer held so no spring engages until release.
      pointerDown.current = true;
      cancelSnap();
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
    },
    [cancelSnap],
  );
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
    const moved = drag.current.moved;
    if (moved) suppressClick.current = true;
    drag.current.active = false;
    pointerDown.current = false;
    // Mouse-drag has no momentum, so no native scrollend fires on release —
    // settle explicitly. Touch/trackpad momentum keeps scrolling and fires
    // scrollend itself, handled by the listener below.
    if (moved) onSettle();
  }, [onSettle]);

  // Settle = native scrollend where supported, else a scroll-idle debounce.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (SUPPORTS_SCROLLEND) {
      stage.addEventListener("scrollend", onSettle);
      return () => stage.removeEventListener("scrollend", onSettle);
    }
    let idle = 0;
    const onIdle = () => {
      clearTimeout(idle);
      idle = window.setTimeout(onSettle, SETTLE_IDLE_MS);
    };
    stage.addEventListener("scroll", onIdle);
    return () => {
      stage.removeEventListener("scroll", onIdle);
      clearTimeout(idle);
    };
  }, [onSettle]);
  useEffect(() => () => cancelSnap(), [cancelSnap]);

  const inWindow = (rect: { x: number; y: number; w: number; h: number }) =>
    rect.x < view.left + view.vw + OVERSCAN &&
    rect.x + rect.w > view.left - OVERSCAN &&
    rect.y < view.top + view.vh + OVERSCAN &&
    rect.y + rect.h > view.top - OVERSCAN;

  const visible = PLACED.filter(({ rect }) => inWindow(rect));
  const visiblePlaceholders = BENTO_RECTS.filter(({ rect }) => inWindow(rect));

  // The tile under the viewport crosshair (world-space center of the view).
  // Updates every scroll frame via `view`; null when the center lands in a gap.
  const centerX = view.left + view.vw / 2;
  const centerY = view.top + view.vh / 2;
  const centeredId = targetAt(centerX, centerY)?.id;

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
        {/* Decorative empty tiles filling the free space around the cluster.
            Ambient only: rendered first (under real tiles) and pointer-transparent
            so they never intercept taps. */}
        {visiblePlaceholders.map(({ id, rect }) => (
          <div
            key={id}
            className={id === centeredId ? "is-centered" : undefined}
            style={{
              position: "absolute",
              left: rect.x,
              top: rect.y,
              width: rect.w,
              height: rect.h,
              pointerEvents: "none",
            }}
          >
            <PlaceholderTile />
          </div>
        ))}

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
              className={id === centeredId ? "is-centered" : undefined}
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
        <CenterCrosshair />
        <Minimap
          view={view}
          tiles={PLACED.map((p) => ({ ...p.rect, label: p.entry.label }))}
          ghosts={BENTO_RECTS.map((p) => p.rect)}
          onJump={jumpTo}
        />
      </div>
      <TileModalHost entry={activeModal} onClose={() => setActiveModal(null)} />
    </div>
  );
}
