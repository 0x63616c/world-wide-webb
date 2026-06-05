import { QueryErrorResetBoundary } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { BUILD_HASH } from "../config/build";
import { BOARD_H, BOARD_W, tileWorldRect, WORLD_H, WORLD_W } from "../lib/grid-constants";
import { useAnyModalOpen } from "../lib/modal-open-store";
import { BENTO_RECTS } from "../lib/placeholder-tiles";
import { TILE_REGISTRY, type TileRegistryEntry } from "../lib/tile-registry";
import { ConnectionLostBanner } from "./ConnectionLostBanner";
import { MINIMAP_BOTTOM, MINIMAP_HEIGHT, Minimap } from "./Minimap";
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

// ─── snap-mode experiment (CC test) ──────────────────────────────────────────
// We're A/B-testing how the board should settle. Three of these are NATIVE CSS
// scroll-snap (browser does the momentum + snapping on the compositor thread —
// no JS spring to fight, so no Mac-trackpad jitter); "spring" is the legacy
// hand-rolled SmoothDamp magnetic snap, kept only so it can be compared head to
// head on-device. Once Calum picks a winner, delete the others + the switcher.
const SNAP_MODES = ["proximity", "mandatory", "none", "spring"] as const;
type SnapMode = (typeof SNAP_MODES)[number];
const SNAP_MODE_KEY = "cc-board-snap-mode";
const SNAP_MODE_LABEL: Record<SnapMode, string> = {
  proximity: "snap: gentle",
  mandatory: "snap: paged",
  none: "snap: off",
  spring: "snap: spring (old)",
};
// CSS scroll-snap-type per mode; "spring" disables native snap (JS drives it).
const SNAP_CSS: Record<SnapMode, string> = {
  proximity: "both proximity",
  mandatory: "both mandatory",
  none: "none",
  spring: "none",
};
function loadSnapMode(): SnapMode {
  // try/catch: localStorage is absent in SSR and some test envs, and throws in
  // private-mode Safari. A missing/blocked store just falls back to the default.
  try {
    const saved = window.localStorage?.getItem(SNAP_MODE_KEY);
    if (saved && (SNAP_MODES as readonly string[]).includes(saved)) return saved as SnapMode;
  } catch {
    // ignore — fall through to the default
  }
  return "proximity";
}

type Rect = { x: number; y: number; w: number; h: number };

// One cell on the board's world lattice. A cell WITH an `entry` is a real,
// interactive tile (mounts its component, opens a modal + recenters on tap); a
// cell WITHOUT one is decorative bento fill (inert, pointer-transparent). Both
// share identical geometry, so the board positions, windows, snaps, highlights,
// and centers them through this one shape — there is no separate placeholder
// render path. Placeholders genuinely have no component/label and live on
// world-absolute coords, so they stay out of TILE_REGISTRY; the two sources
// merge HERE into the single list everything downstream consumes.
type BoardCell = { id: string; rect: Rect; entry?: TileRegistryEntry };

// The single source of truth for every cell. Placeholders come FIRST so they
// paint BENEATH the real tiles (DOM order = paint order); real tiles overlay.
const BOARD_CELLS: BoardCell[] = [
  ...BENTO_RECTS.map((b) => ({ id: b.id, rect: b.rect })),
  ...TILE_REGISTRY.map((entry) => ({ id: entry.id, rect: tileWorldRect(entry), entry })),
];

// The cell whose rect contains world point (cx, cy), or undefined in a gap.
// Real tiles and placeholders never overlap, so the first match is unambiguous.
function cellAt(cx: number, cy: number): BoardCell | undefined {
  return BOARD_CELLS.find(
    ({ rect }) => cx >= rect.x && cx <= rect.x + rect.w && cy >= rect.y && cy <= rect.y + rect.h,
  );
}

// First-render SEED only. vw/vh use the panel's target size as a placeholder;
// the useLayoutEffect below immediately overwrites left/top/vw/vh from the real
// (full-window) stage size before paint, so on any screen the board opens with
// the Clock dead center. Nothing here clips the view to BOARD_W×BOARD_H.
const INITIAL_VIEW = {
  left: WORLD_W / 2 - BOARD_W / 2,
  top: WORLD_H / 2 - BOARD_H / 2,
  vw: BOARD_W,
  vh: BOARD_H,
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

// Small live FPS readout pinned bottom-right, for tuning the canvas feel on-device.
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
        bottom: 2,
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

// Git short SHA of the running web bundle, pinned bottom-left as the mirror of
// the FPS readout. Lets you tell at a glance which build a wall panel is on.
function BuildHashBadge() {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 2,
        left: 12,
        fontFamily: "var(--mono)",
        fontSize: 11,
        letterSpacing: "-0.02em",
        color: "var(--ink-3)",
      }}
    >
      {BUILD_HASH.slice(0, 7)}
    </div>
  );
}

// Dev-only switcher to flip the board's settle feel live, on-device. Pinned
// bottom-right above the FPS meter; cycles through SNAP_MODES on tap. Temporary
// (see SNAP_MODES note) — remove once the winning feel is chosen.
function SnapModeSwitcher({ mode, onCycle }: { mode: SnapMode; onCycle: () => void }) {
  return (
    <button
      type="button"
      onClick={onCycle}
      style={{
        position: "absolute",
        bottom: 28,
        right: 12,
        pointerEvents: "auto",
        padding: "4px 9px",
        background: "rgba(12, 14, 17, 0.92)",
        border: "1px solid var(--hair-2)",
        borderRadius: 6,
        fontFamily: "var(--mono)",
        fontSize: 11,
        letterSpacing: "-0.02em",
        color: "var(--ink-2)",
        cursor: "pointer",
      }}
    >
      {SNAP_MODE_LABEL[mode]}
    </button>
  );
}

// Name of the tile currently under the viewport center, shown as a pill in the
// bottom-left while you pan the board manually (mouse-drag or touch), then fading
// out like the minimap does. The minimap surfaces tile names on hover; this is
// the same affordance for plain panning, where there's no cursor over the map.
// Stacked directly above the minimap so the two never overlap in the corner.
function CenteredTileLabel({
  label,
  view,
}: {
  label: string | undefined;
  view: typeof INITIAL_VIEW;
}) {
  const [visible, setVisible] = useState(false);
  const isFirstView = useRef(true);
  // Driven off `view` identity (a fresh object every pan frame) exactly like the
  // minimap, so any pan re-shows the label and resets the fade timer. The first
  // change is the on-mount centering effect, skipped so it doesn't flash on load.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `view` isn't read here — its identity change on every pan is the trigger.
  useEffect(() => {
    if (isFirstView.current) {
      isFirstView.current = false;
      return;
    }
    setVisible(true);
    const t = window.setTimeout(() => setVisible(false), 1500);
    return () => window.clearTimeout(t);
  }, [view]);

  return (
    <div
      style={{
        position: "absolute",
        // Stack directly above the minimap box (same left edge) so neither the
        // map nor this label ever obscures the other.
        left: 12,
        bottom: MINIMAP_BOTTOM + MINIMAP_HEIGHT + 8,
        padding: "3px 8px",
        background: "rgba(12, 14, 17, 0.92)",
        border: "1px solid var(--hair-2)",
        borderRadius: 6,
        fontFamily: "var(--ui)",
        fontSize: 11,
        lineHeight: 1.2,
        letterSpacing: "-0.01em",
        color: "var(--ink)",
        whiteSpace: "nowrap",
        // Fade out when hidden OR when the center sits over a gap (no label).
        opacity: visible && label ? 1 : 0,
        transition: "opacity 0.4s ease",
      }}
    >
      {label}
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
  // Live-switchable settle feel (see SNAP_MODES). Mirrored into a ref so the
  // memoized pointer/glide handlers read the current mode without re-creating.
  const [snapMode, setSnapMode] = useState<SnapMode>(loadSnapMode);
  const snapModeRef = useRef(snapMode);
  useEffect(() => {
    snapModeRef.current = snapMode;
    try {
      window.localStorage?.setItem(SNAP_MODE_KEY, snapMode);
    } catch {
      // ignore — persistence is best-effort (blocked/full store)
    }
  }, [snapMode]);
  const cycleSnapMode = useCallback(() => {
    setSnapMode((m) => SNAP_MODES[(SNAP_MODES.indexOf(m) + 1) % SNAP_MODES.length]);
  }, []);

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
  // Mirrors modal-open state into a ref so the memoized pointer handlers can bail
  // without being re-created. While a modal is open the board must NOT pan: a
  // press outside the modal hits the modal's own backdrop (which closes it), and
  // native scroll is frozen via the stage style below.
  //
  // `activeModal` covers modals the board opens itself; `useAnyModalOpen()` also
  // catches modals a tile manages on its own (e.g. ControlsTile's expanded view),
  // whose portaled backdrop would otherwise replay presses up the React tree into
  // this stage's drag-pan. OR-ing both keeps the freeze instant for the board's
  // own open-glide while still covering every other modal.
  const anyModalOpen = useAnyModalOpen();
  const modalOpen = activeModal !== null || anyModalOpen;
  const modalOpenRef = useRef(modalOpen);
  useEffect(() => {
    modalOpenRef.current = modalOpen;
  }, [modalOpen]);

  // Any click within a tile recenters the camera on that tile — even taps that
  // land on an inner control (toggle/slider/button) or on a self-tapping tile
  // (Controls). Runs in the capture phase (wired via onClickCapture) so an inner
  // stopPropagation — e.g. the Controls body tap — can't swallow the recenter.
  // The modal still opens only for a "plain" tap: a self-tapping tile runs its
  // own UI and a tap on a control drives that control, so neither also opens the
  // board's detail modal.
  function onTileClickCapture(entry: TileRegistryEntry, e: React.MouseEvent<HTMLDivElement>) {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (entry.ownsTap || (e.target as HTMLElement).closest(INTERACTIVE_SELECTOR)) {
      glideToTile(entry);
      return;
    }
    openModalFor(entry);
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

  // Glide the camera so `entry` lands dead center, reusing the snap spring (same
  // SmoothDamp feel as settle-snapping) instead of a separate animation. Opening
  // a modal freezes native pan (overflow:hidden on the stage), but an
  // overflow:hidden element is still a *programmatic* scroll container, so these
  // scrollLeft/Top writes keep driving the glide to completion behind the modal.
  const glideToTile = useCallback(
    (entry: TileRegistryEntry) => {
      const stage = stageRef.current;
      if (!stage) return;
      const rect = tileWorldRect(entry);
      const toLeft = rect.x + rect.w / 2 - stage.clientWidth / 2;
      const toTop = rect.y + rect.h / 2 - stage.clientHeight / 2;
      // Spring mode drives the glide in JS; native modes use the browser's own
      // smooth scroll, which then respects scroll-snap on arrival. scrollTo is
      // absent in some test/SSR envs — fall back to a direct (instant) set.
      if (snapModeRef.current === "spring") springTo(toLeft, toTop);
      else if (typeof stage.scrollTo === "function")
        stage.scrollTo({ left: toLeft, top: toTop, behavior: "smooth" });
      else {
        stage.scrollLeft = toLeft;
        stage.scrollTop = toTop;
      }
    },
    [springTo],
  );

  // Recenter on a tile AND open its detail modal, kicked off together. Shared by
  // the plain-tap and keyboard activation paths.
  const openModalFor = useCallback(
    (entry: TileRegistryEntry) => {
      glideToTile(entry);
      const modal = getTileModalEntry(entry.id);
      if (modal) setActiveModal(modal);
    },
    [glideToTile],
  );

  // On settle (scrolling stopped AND nothing held): gravitate the tile under the
  // crosshair to the viewport center. Reads scroll state live rather than `view`
  // so it's correct the instant the pan stops. Skips when already centered.
  const onSettle = useCallback(() => {
    // Only the legacy JS spring magnetically re-centers on settle; the native
    // scroll-snap modes let the browser do it (no JS = no trackpad fight).
    if (snapModeRef.current !== "spring") return;
    // Ignore the settle from our own spring, and never fight a held pointer.
    if (spring.current.raf || pointerDown.current || drag.current.active) return;
    const stage = stageRef.current;
    if (!stage) return;
    const cx = stage.scrollLeft + stage.clientWidth / 2;
    const cy = stage.scrollTop + stage.clientHeight / 2;
    const hit = cellAt(cx, cy);
    if (!hit) return; // crosshair over a gap (rare; world is fully tiled) → leave it
    const toLeft = hit.rect.x + hit.rect.w / 2 - stage.clientWidth / 2;
    const toTop = hit.rect.y + hit.rect.h / 2 - stage.clientHeight / 2;
    if (Math.hypot(toLeft - stage.scrollLeft, toTop - stage.scrollTop) < SNAP_DEADZONE) return;
    springTo(toLeft, toTop);
  }, [springTo]);

  // Desktop mouse-drag-to-pan. Touch is left to native momentum scrolling.
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Modal open: the board is frozen. Let the press fall through to the
      // modal's backdrop (close) instead of starting a pan.
      if (modalOpenRef.current) return;
      // A press that lands on an inner control (slider/toggle/button/link) drives
      // THAT control, not the board — without this, dragging the A/C setpoint
      // slider was read as a board pan and scrolled the whole screen. Native CSS
      // touch-action:none on the slider blocks the touch/trackpad pan; this blocks
      // the mouse-drag shim. The tile still recenters via onTileClickCapture.
      if ((e.target as HTMLElement).closest(INTERACTIVE_SELECTOR)) return;
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
    if (!d.moved) {
      d.moved = true;
      stage.style.cursor = "grabbing";
      // Suspend native scroll-snap for the duration of the drag: the shim writes
      // scrollLeft/Top every frame, and a live snap would re-pull toward a nearby
      // tile on each write, fighting the drag (the click-drag jitter). Restored
      // on release, which re-snaps once. No-op in none/spring modes (already none).
      stage.style.scrollSnapType = "none";
    }
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
    // Re-arm native snap (matching the active mode); assigning the value re-snaps
    // to the nearest tile in proximity/mandatory. "spring"/"none" → "none".
    if (stage) stage.style.scrollSnapType = SNAP_CSS[snapModeRef.current];
    // Mouse-drag has no momentum, so no native scrollend fires on release —
    // settle explicitly (spring mode only; onSettle bails otherwise).
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

  // One windowed list for the whole board: real tiles and placeholders alike.
  const visibleCells = BOARD_CELLS.filter(({ rect }) => inWindow(rect));

  // The cell under the viewport crosshair (world-space center of the view).
  // Updates every scroll frame via `view`; null when the center lands in a gap.
  const centerX = view.left + view.vw / 2;
  const centerY = view.top + view.vh / 2;
  const centered = cellAt(centerX, centerY);
  const centeredId = centered?.id;
  // Label for the centered cell (bento fill has no entry → undefined), surfaced
  // bottom-left while panning.
  const centeredLabel = centered?.entry?.label;

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
        // Modal open: freeze native scroll so the board can't pan behind it.
        // Both touch and trackpad scroll route through this element, so killing
        // overflow + touchAction here stops every panning vector at once.
        overflow: modalOpen ? "hidden" : "auto",
        background: "var(--bg)",
        // Pan is one-finger native scroll; no rubber-band past the world edges.
        touchAction: modalOpen ? "none" : "pan-x pan-y",
        // Native settle feel: the browser snaps each tile's center to the
        // viewport center on the compositor thread (no JS spring → no jitter).
        // "spring"/"none" disable it; see SNAP_MODES.
        scrollSnapType: modalOpen ? "none" : SNAP_CSS[snapMode],
        overscrollBehavior: "none",
        cursor: "grab",
        scrollbarWidth: "none",
      }}
    >
      <div
        id="world"
        className="e-root"
        style={{
          position: "relative",
          width: WORLD_W,
          height: WORLD_H,
          backgroundColor: "var(--bg)",
        }}
      >
        {/* ONE render path for every cell. Geometry (position, size, snap target,
            centered highlight) is written once and shared; a cell with an `entry`
            renders an interactive tile, one without renders inert bento fill.
            Placeholders sort first in BOARD_CELLS so they paint underneath. */}
        {visibleCells.map(({ id, rect, entry }) => {
          const geometry: React.CSSProperties = {
            position: "absolute",
            left: rect.x,
            top: rect.y,
            width: rect.w,
            height: rect.h,
            // Snap target: every cell's center docks to the viewport center.
            scrollSnapAlign: "center",
          };
          const centeredClass = id === centeredId ? "is-centered" : undefined;

          // Decorative bento fill: pointer-transparent so it never intercepts
          // taps, no component, no interaction.
          if (!entry) {
            return (
              <div
                key={id}
                className={centeredClass}
                style={{ ...geometry, pointerEvents: "none" }}
              >
                <PlaceholderTile />
              </div>
            );
          }

          const TileComponent = entry.component;
          return (
            // Not a real <button>: the tile body contains its own buttons
            // (toggles, sliders, "More"), and nesting interactive elements is
            // invalid. role+tabIndex give the wrapper button semantics while
            // keeping inner controls separately operable.
            // biome-ignore lint/a11y/useSemanticElements: nested interactive content forbids a <button>
            <div
              key={id}
              className={centeredClass}
              style={{ ...geometry, cursor: "pointer" }}
              role="button"
              tabIndex={0}
              aria-label={`Open ${entry.label}`}
              onClickCapture={(e) => onTileClickCapture(entry, e)}
              onKeyDown={(e) => {
                if (entry.ownsTap) return;
                if (e.target !== e.currentTarget) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openModalFor(entry);
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
        <BuildHashBadge />
        <SnapModeSwitcher mode={snapMode} onCycle={cycleSnapMode} />
        <CenteredTileLabel label={centeredLabel} view={view} />
        <Minimap
          view={view}
          // Both layers derive from the one BOARD_CELLS list: real tiles (with a
          // label) and placeholder ghosts (no entry). flatMap narrows `entry`.
          tiles={BOARD_CELLS.flatMap((c) => (c.entry ? [{ ...c.rect, label: c.entry.label }] : []))}
          ghosts={BOARD_CELLS.flatMap((c) => (c.entry ? [] : [c.rect]))}
          onJump={jumpTo}
        />
      </div>
      <TileModalHost entry={activeModal} onClose={() => setActiveModal(null)} />
    </div>
  );
}
