/**
 * Board mechanics extracted from Board.tsx so the component body reads as
 * composition rather than implementation. Each hook owns one concern:
 *
 *  useBoardViewport  , scroll position + client size → `view` state
 *  useUserPanSignal  , user-driven vs programmatic scroll discrimination
 *  useBoardSnap      , wires the board-camera settle to scrollend/idle (physics
 *                      + settle math live in lib/board-camera now)
 *  useBoardDragPan   , desktop mouse-drag-to-pan shim
 *  useIdleTimer      , generic "fire after N ms idle" primitive (shared)
 *  useIdleReset      , return to the home view after an idle timeout
 *  useIdleDim        , dim the panel after a configurable idle timeout
 *  getVisibleTiles   , pure windowing filter (no hook, no side effects)
 *
 * The Board component still owns the DOM ref, the modal state, and the render
 * output; these hooks delegate all imperative scroll mechanics.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { cameraCancel, cameraSettle } from "../../lib/board-camera";
import { dimTo, wakeTo } from "../../lib/brightness";
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

// ─── useIdleTimer (shared idle primitive) ─────────────────────────────────────

/** Idle window before the board returns to the home (clock) view. */
export const IDLE_RESET_MS = 10 * 60_000;

// Interaction events that count as "the panel is in use" and rearm the timer,
// paired with where each is listened for. Listed once so attach + detach stay in
// lockstep.
//
// WHY taps ride `window` and not the stage: every modal portals to <body>, i.e.
// OUTSIDE the #stage subtree, so a stage-local pointerdown never sees a tap
// inside an open modal. That left the panel unable to register activity at all
// while a modal was up , it would dim mid-Settings and stay dim until you closed
// the modal and tapped the board. Taps are a global "a human is here" signal, so
// they belong on window; capture phase so an inner stopPropagation can't hide
// one. wheel/scroll stay stage-local: they are pan signals, and the
// isProgrammatic guard below is written against the stage's own scroll stream.
const IDLE_EVENTS = [
  { type: "pointerdown", target: "window" },
  { type: "touchstart", target: "window" },
  { type: "keydown", target: "window" },
  { type: "wheel", target: "stage" },
  { type: "scroll", target: "stage" },
] as const;

type UseIdleTimerOptions = {
  /**
   * The stage element, or null while it is unmounted. Deliberately the ELEMENT
   * and not a ref: the board gates the stage behind a layout-loading screen, so
   * a ref would read null on the first commit and , being referentially stable ,
   * would never re-run this effect once the real stage arrived, silently killing
   * every idle window for the life of the page.
   */
  stage: HTMLDivElement | null;
  /** Idle window in ms. */
  ms: number;
  /** Fired once the window elapses with no interaction (and no deferral). */
  onIdle: () => void;
  /** Fired on the first interaction AFTER onIdle fired , e.g. to undo it. */
  onActive?: () => void;
  /** When it returns true at fire time, defer (reschedule) instead of firing. */
  shouldDefer?: () => boolean;
  /**
   * When it returns true at EVENT time, the raw activity event is dropped ,
   * it neither rearms the window nor fires onActive. poke() still works, so a
   * caller can make itself the only legitimate "activity" source for a while
   * (the dim overlay does this: while dimmed, the window-capture listeners see
   * the wake tap BEFORE the overlay's own handler, and un-dimming from here
   * unmounts the overlay mid-dispatch , React flushes state at the microtask
   * checkpoint between listeners , so the tap fell through to the tile).
   */
  shouldIgnoreEvent?: () => boolean;
  /** When false the timer + listeners are inert (the feature is disabled). */
  enabled?: boolean;
  /**
   * True while an app-driven glide owns the scroll stream. Scroll frames are
   * then ignored as activity , the board's own goHome glide would otherwise
   * rearm every idle window the instant the reset fired.
   */
  isProgrammatic?: React.RefObject<boolean>;
};

/**
 * Generic "do X after `ms` of no interaction, undo X on the next interaction"
 * primitive. The board's idle-reset and idle-dim both ride this so the activity
 * model (which events count, the held-pointer deferral, attach/detach lockstep)
 * lives in exactly one place.
 *
 * WHY a self-rescheduling timeout rather than setInterval: a fired timer that
 * can't act yet (shouldDefer true , e.g. a pointer still held) must defer
 * WITHOUT counting that wait as a fresh idle window , it reschedules one short
 * tick later and re-checks, so a held finger never silently consumes the budget.
 *
 * Callbacks are read through a ref so the effect mounts once per (stage, ms,
 * enabled) and never re-attaches listeners just because a fresh closure was
 * passed in.
 */
function useIdleTimer({
  stage,
  ms,
  onIdle,
  onActive,
  shouldDefer,
  shouldIgnoreEvent,
  enabled = true,
  isProgrammatic,
}: UseIdleTimerOptions): { poke: () => void } {
  const cbRef = useRef({ onIdle, onActive, shouldDefer, shouldIgnoreEvent, isProgrammatic });
  cbRef.current = { onIdle, onActive, shouldDefer, shouldIgnoreEvent, isProgrammatic };

  // Holds the live effect's `arm` so poke() can rearm/undim from the outside
  // (e.g. a wake tap that the dim overlay swallowed before the stage saw it).
  // No-op between mounts / while disabled.
  const armRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!enabled || !stage) return;

    let timer = 0;
    // Whether onIdle has fired since the last interaction , gates onActive so it
    // fires exactly once per idle→active transition.
    let idle = false;

    const fire = () => {
      if (cbRef.current.shouldDefer?.()) {
        timer = window.setTimeout(fire, 1_000);
        return;
      }
      idle = true;
      cbRef.current.onIdle();
    };

    const arm = () => {
      if (idle) {
        idle = false;
        cbRef.current.onActive?.();
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(fire, ms);
    };
    armRef.current = arm;

    // Scroll is the one activity signal the app also emits itself: goHome's
    // smooth glide fires a frame per tick, which would rearm both windows the
    // moment the reset fired (and un-dim a panel that just dimmed). Every other
    // event in IDLE_EVENTS is unambiguously a human.
    const onEvent = (event: Event) => {
      if (cbRef.current.shouldIgnoreEvent?.()) return;
      if (event.type === "scroll" && cbRef.current.isProgrammatic?.current) return;
      arm();
    };

    for (const { type, target: where } of IDLE_EVENTS) {
      const target: EventTarget = where === "window" ? window : stage;
      target.addEventListener(type, onEvent, { passive: true, capture: true });
    }

    arm();

    return () => {
      window.clearTimeout(timer);
      armRef.current = () => {};
      for (const { type, target: where } of IDLE_EVENTS) {
        const target: EventTarget = where === "window" ? window : stage;
        target.removeEventListener(type, onEvent, { capture: true });
      }
    };
  }, [stage, ms, enabled]);

  // Stable handle: forwards to the current mount's arm (or no-op when unmounted).
  const poke = useCallback(() => armRef.current(), []);
  return { poke };
}

// ─── useIdleReset ─────────────────────────────────────────────────────────────

type UseIdleResetOptions = {
  /** The stage element, or null while unmounted (see UseIdleTimerOptions). */
  stage: HTMLDivElement | null;
  /** True while an app-driven glide owns the scroll stream. */
  isProgrammatic?: React.RefObject<boolean>;
  /** Navigate the board back to the home view (e.g. jumpTo world-center). */
  goHome: () => void;
  /** True when the viewport is already centered on home (within a deadzone). */
  isHome: () => boolean;
  /** True while a pointer is held , never navigate mid-interaction. */
  pointerDown: React.RefObject<boolean>;
  /** Idle window in ms; defaults to IDLE_RESET_MS (injectable for tests). */
  idleMs?: number;
  /** When false the recenter never fires (feature disabled). Defaults true. */
  enabled?: boolean;
};

/**
 * Returns the board to the home view after `idleMs` with zero user interaction,
 * so an unattended wall panel resettles on the clock. Pure/decoupled: it takes a
 * `goHome` navigator and an `isHome` predicate, so the Board wires the concrete
 * jumpTo-to-world-center while this stays unit-testable without real DOM scroll.
 * Deferral (held pointer OR already-home) rides useIdleTimer.shouldDefer.
 */
export function useIdleReset({
  stage,
  isProgrammatic,
  goHome,
  isHome,
  pointerDown,
  idleMs = IDLE_RESET_MS,
  enabled = true,
}: UseIdleResetOptions): { poke: () => void } {
  return useIdleTimer({
    stage,
    isProgrammatic,
    ms: idleMs,
    enabled,
    onIdle: goHome,
    shouldDefer: () => pointerDown.current || isHome(),
  });
}

// ─── useIdleDim ───────────────────────────────────────────────────────────────

type UseIdleDimOptions = {
  /** The stage element, or null while unmounted (see UseIdleTimerOptions). */
  stage: HTMLDivElement | null;
  /** True while an app-driven glide owns the scroll stream. */
  isProgrammatic?: React.RefObject<boolean>;
  /** True while a pointer is held , never dim mid-interaction. */
  pointerDown: React.RefObject<boolean>;
  /** Feature toggle; false disables dimming entirely (and wakes if dimmed). */
  enabled: boolean;
  /** Idle window in ms before dimming. */
  timeoutMs: number;
  /** Dim target as a 0..1 brightness fraction. */
  level: number;
  /** Awake backlight (0..1) the panel holds when NOT dimmed, overriding the OS. */
  activeBrightness: number;
};

/**
 * Dims the panel after `timeoutMs` of no interaction and wakes it (back to the
 * active brightness) on the next interaction. This drives the real iPad backlight
 * absolutely (see lib/brightness), overriding the OS brightness. It is native
 * only: off-device dimTo/wakeTo are no-ops, and the caller passes `enabled: false`
 * in a browser so the whole feature (timer + returned `dimmed`) stays inert.
 *
 * The brightness side-effect lives in an effect keyed on (enabled, dimmed, level,
 * activeBrightness) , NOT inside the timer callbacks , so a live level/brightness
 * change re-applies immediately and disabling mid-dim wakes at once.
 */
export function useIdleDim({
  stage,
  isProgrammatic,
  pointerDown,
  enabled,
  timeoutMs,
  level,
  activeBrightness,
}: UseIdleDimOptions): { dimmed: boolean; wake: () => void } {
  const [dimmed, setDimmed] = useState(false);
  // Synchronous mirror of `dimmed` for raw event listeners: state is only
  // current as of the last render, and the wake tap's events race ahead of it.
  const dimmedRef = useRef(false);
  const setDimmedNow = useCallback((value: boolean) => {
    dimmedRef.current = value;
    setDimmed(value);
  }, []);

  const { poke } = useIdleTimer({
    stage,
    isProgrammatic,
    ms: timeoutMs,
    enabled,
    shouldDefer: () => pointerDown.current,
    onIdle: () => setDimmedNow(true),
    onActive: () => setDimmedNow(false),
    // While dimmed the overlay is the ONLY legitimate waker (it calls wake()).
    // Raw window/stage events must be inert: the window-capture listener sees
    // the wake tap before the overlay's handler, and un-dimming from it
    // unmounts the overlay mid-dispatch, so the tap clicks the tile beneath.
    shouldIgnoreEvent: () => dimmedRef.current,
  });

  // Disabled mid-dim, or the stage went away mid-dim (the board swapped back to
  // its loading screen): clear the flag so the overlay clears too, since the
  // timer that would have cleared it via onActive is gone. The effect below then
  // wakes the backlight.
  useEffect(() => {
    if ((!enabled || !stage) && dimmed) setDimmedNow(false);
  }, [enabled, stage, dimmed, setDimmedNow]);

  // Apply the backlight off the resolved state. The else-branch (awake, disabled,
  // mount) drives the panel to its active brightness , the app always owns the
  // backlight, so a hand-dimmed iPad still comes up at the configured level.
  useEffect(() => {
    if (enabled && dimmed) void dimTo(level);
    else void wakeTo(activeBrightness);
  }, [enabled, dimmed, level, activeBrightness]);

  // Never leave the backlight dimmed if the board unmounts mid-dim. Read the live
  // active brightness through a ref so the once-only cleanup uses the latest.
  const activeRef = useRef(activeBrightness);
  activeRef.current = activeBrightness;
  useEffect(() => () => void wakeTo(activeRef.current), []);

  // `wake` = poke the timer: undoes the dim (onActive) AND rearms the window, so
  // the dim overlay can swallow the first tap (keeping it off the tile) while
  // still waking the panel.
  return { dimmed, wake: poke };
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
