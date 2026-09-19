/**
 * Board mechanics extracted from Board.tsx so the component body reads as
 * composition rather than implementation. Each hook owns one concern:
 *
 *  useBoardViewport  , scroll position + client size → `view` state
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

import { useCallback, useRef, useState } from "react";

// ─── types ────────────────────────────────────────────────────────────────────

export type BoardView = { left: number; top: number; vw: number; vh: number };

type Rect = { x: number; y: number; w: number; h: number };

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

// ─── useBoardDragPan ──────────────────────────────────────────────────────────

const INTERACTIVE_SELECTOR = 'button, input, a, select, textarea, [role="slider"]';

type UseBoardDragPanOptions = {
  stageRef: React.RefObject<HTMLDivElement | null>;
  modalOpenRef: React.RefObject<boolean>;
};

/**
 * Desktop mouse-drag-to-pan shim. Touch is left to native momentum scrolling.
 * Returns `onPointerDown`, `onPointerMove`, and `endDrag` handler props.
 *
 * `drag` is passed in (not created here) so Board can read the live drag state
 * alongside the held-pointer ref.
 */
export function useBoardDragPan({
  stageRef,
  drag,
  modalOpenRef,
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

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (modalOpenRef.current) return;
      if ((e.target as HTMLElement).closest(INTERACTIVE_SELECTOR)) return;
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
    [stageRef, modalOpenRef, drag],
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
  }, [stageRef, drag]);

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
