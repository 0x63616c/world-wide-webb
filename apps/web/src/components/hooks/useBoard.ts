/**
 * Board mechanics extracted from Board.tsx so the component body reads as
 * composition rather than implementation. Each hook owns one concern:
 *
 *  useBoardViewport  , scroll position + client size → `view` state
 *  useUserPanSignal  , user-driven vs programmatic scroll discrimination
 *  useBoardSnap      , wires the board-camera settle to scrollend/idle (physics
 *                      + settle math live in lib/board-camera now)
 *  useBoardDragPan   , desktop mouse-drag-to-pan shim
 *  getVisibleTiles   , pure windowing filter (no hook, no side effects)
 *
 * The idle mechanics (idle-reset glide-home + idle-dim) that used to live here
 * are gone: they were folded into the single panel-session activity clock (one
 * timeout, one SESSION END = dim + home + relock), wired directly in Board.
 *
 * The Board component still owns the DOM ref, the modal state, and the render
 * output; these hooks delegate all imperative scroll mechanics.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { cameraCancel, cameraSettle } from "../../lib/board-camera";
import type { SnapMode } from "../../lib/settings";

// ─── types ────────────────────────────────────────────────────────────────────

export type BoardView = { left: number; top: number; vw: number; vh: number };

type Rect = { x: number; y: number; w: number; h: number };

// ─── snap constants (shared between hooks) ────────────────────────────────────

// Native scrollend fires once momentum settles (Safari 16+, Chrome 114+).
const SUPPORTS_SCROLLEND = typeof window !== "undefined" && "onscrollend" in window;
const SETTLE_IDLE_MS = 140;

// Drag past this many px before a press counts as a pan, not a tap.
const DRAG_THRESHOLD = 5;

// ─── useBoardViewport ─────────────────────────────────────────────────────────

/**
 * Tracks the visible slice of the world. Returns the current `view` and a
 * `syncView` callback that reads the stage's live scroll position.
 */
export function useBoardViewport(
  stageRef: React.RefObject<HTMLDivElement | null>,
  initialView: BoardView,
): { view: BoardView; syncView: () => void } {
  const [view, setView] = useState<BoardView>(initialView);

  const syncView = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    setView({
      left: stage.scrollLeft,
      top: stage.scrollTop,
      vw: stage.clientWidth,
      vh: stage.clientHeight,
    });
  }, [stageRef]);

  return { view, syncView };
}

// ─── useUserPanSignal ─────────────────────────────────────────────────────────

// How long after the last programmatic scroll frame before the scroll stream is
// considered the user's again. Smooth scrollTo fires a frame every ~16ms, so any
// gap this long means the glide finished (or was abandoned).
const PROGRAMMATIC_QUIET_MS = 200;

/**
 * Distinguishes user-driven viewport movement from app-driven navigation, so
 * pan-reactive chrome (the minimap, the centered-tile label) appears only when
 * the USER moves the board , never during the idle-reset glide home or the
 * mount centering.
 *
 * `panSignal` bumps on every user-driven scroll frame; key visibility effects
 * off it (it starts at 0 = "no user pan yet"). Programmatic navigators call
 * `markProgrammatic()` before scrolling; that flag owns the scroll stream until
 * it goes quiet for PROGRAMMATIC_QUIET_MS or the user grabs the board (any
 * `markUser()` , wired to pointerdown/wheel and the user-nav entry points).
 * The flag starts true because the mount-centering write is programmatic.
 */
export function useUserPanSignal(): {
  panSignal: number;
  markProgrammatic: () => void;
  markUser: () => void;
  onScrollFrame: () => void;
  /**
   * Live "an app-driven glide owns the scroll stream right now" flag. Exposed so
   * the idle timers can discount the scroll frames the board emits itself , a
   * goHome glide must not count as the user being present.
   */
  isProgrammatic: React.RefObject<boolean>;
} {
  const [panSignal, setPanSignal] = useState(0);
  const programmatic = useRef(true);
  const quietTimer = useRef(0);

  const markProgrammatic = useCallback(() => {
    programmatic.current = true;
  }, []);

  const markUser = useCallback(() => {
    programmatic.current = false;
    window.clearTimeout(quietTimer.current);
  }, []);

  const onScrollFrame = useCallback(() => {
    if (programmatic.current) {
      // App-driven glide in flight: swallow the frame, re-arm the quiet timer.
      window.clearTimeout(quietTimer.current);
      quietTimer.current = window.setTimeout(() => {
        programmatic.current = false;
      }, PROGRAMMATIC_QUIET_MS);
      return;
    }
    setPanSignal((s) => s + 1);
  }, []);

  useEffect(() => () => window.clearTimeout(quietTimer.current), []);

  return { panSignal, markProgrammatic, markUser, onScrollFrame, isProgrammatic: programmatic };
}

// ─── useBoardSnap ─────────────────────────────────────────────────────────────

type UseBoardSnapOptions = {
  stageRef: React.RefObject<HTMLDivElement | null>;
};

/**
 * Wires the board-camera's magnetic settle to the stage's scrollend (or an idle
 * debounce where scrollend is unsupported) and cancels any running spring on
 * unmount. A thin adapter , the spring physics + the settle re-center math live
 * in the board-camera module now; the camera reads snap mode / pointer state /
 * cell-at through its host (attached by Board), so this hook needs only the
 * stage to know where to listen.
 */
export function useBoardSnap({ stageRef }: UseBoardSnapOptions): void {
  // Wire scrollend / idle debounce for settle.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (SUPPORTS_SCROLLEND) {
      stage.addEventListener("scrollend", cameraSettle);
      return () => stage.removeEventListener("scrollend", cameraSettle);
    }
    let idle = 0;
    const onIdle = () => {
      clearTimeout(idle);
      idle = window.setTimeout(cameraSettle, SETTLE_IDLE_MS);
    };
    stage.addEventListener("scroll", onIdle);
    return () => {
      stage.removeEventListener("scroll", onIdle);
      clearTimeout(idle);
    };
  }, [stageRef]);

  // Cancel any running spring on unmount.
  useEffect(() => () => cameraCancel(), []);
}

// ─── useBoardDragPan ──────────────────────────────────────────────────────────

const INTERACTIVE_SELECTOR = 'button, input, a, select, textarea, [role="slider"]';

type SnapCssMap = Record<SnapMode, string>;

type UseBoardDragPanOptions = {
  stageRef: React.RefObject<HTMLDivElement | null>;
  snapMode: SnapMode;
  snapCss: SnapCssMap;
  modalOpenRef: React.RefObject<boolean>;
  pointerDown: React.RefObject<boolean>;
  cancelSnap: () => void;
  onSettle: () => void;
};

/**
 * Desktop mouse-drag-to-pan shim. Touch is left to native momentum scrolling.
 * Returns `onPointerDown`, `onPointerMove`, and `endDrag` handler props.
 *
 * `drag` is passed in (not created here) so the same ref can also be passed to
 * `useBoardSnap`, which needs to read `drag.current.active` during settle.
 */
export function useBoardDragPan({
  stageRef,
  drag,
  snapMode,
  snapCss,
  modalOpenRef,
  pointerDown,
  cancelSnap,
  onSettle,
}: UseBoardDragPanOptions & {
  drag: React.RefObject<{
    active: boolean;
    moved: boolean;
    x: number;
    y: number;
    sl: number;
    st: number;
  }>;
}): {
  suppressClick: React.RefObject<boolean>;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  endDrag: () => void;
} {
  const suppressClick = useRef(false);

  const snapModeRef = useRef(snapMode);
  useEffect(() => {
    snapModeRef.current = snapMode;
  }, [snapMode]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (modalOpenRef.current) return;
      if ((e.target as HTMLElement).closest(INTERACTIVE_SELECTOR)) return;
      // Any grab interrupts a running snap and marks the pointer held.
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
    [stageRef, modalOpenRef, pointerDown, cancelSnap, drag],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current;
      const stage = stageRef.current;
      if (!d.active || !stage) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      if (!d.moved) {
        d.moved = true;
        stage.style.cursor = "grabbing";
        // Suspend native scroll-snap for the drag duration to prevent the snap
        // re-pulling toward nearby tiles on every scrollLeft write (jitter fix).
        stage.style.scrollSnapType = "none";
      }
      stage.scrollLeft = d.sl - dx;
      stage.scrollTop = d.st - dy;
    },
    [stageRef, drag],
  );

  const endDrag = useCallback(() => {
    const stage = stageRef.current;
    if (stage) stage.style.cursor = "grab";
    const moved = drag.current.moved;
    if (moved) suppressClick.current = true;
    drag.current.active = false;
    pointerDown.current = false;
    // Re-arm native snap; assigning the value snaps to the nearest tile.
    if (stage) stage.style.scrollSnapType = snapCss[snapModeRef.current];
    // Mouse-drag has no momentum, so no native scrollend fires on release ,
    // settle explicitly (spring mode only; onSettle bails otherwise).
    if (moved) onSettle();
  }, [stageRef, snapCss, pointerDown, onSettle, drag]);

  return { suppressClick, onPointerDown, onPointerMove, endDrag };
}

// ─── getVisibleTiles ──────────────────────────────────────────────────────────

const OVERSCAN = 600;

/**
 * Pure windowing filter. Returns the subset of `cells` whose rects overlap the
 * current viewport (plus OVERSCAN px on each edge so panning never reveals a
 * blank slot before its tile renders).
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
