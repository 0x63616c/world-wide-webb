import { QueryErrorResetBoundary } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { BUILD_HASH, BUILD_TIME } from "../config/build";
import { BOARD_H, BOARD_W, tileWorldRect, WORLD_H, WORLD_W } from "../lib/grid-constants";
import { useAnyModalOpen } from "../lib/modal-open-store";
import { BENTO_RECTS } from "../lib/placeholder-tiles";
import { formatRelativeAge } from "../lib/relative-age";
import { HOME_TILE, TILE_REGISTRY, type TileRegistryEntry } from "../lib/tile-registry";
import { ConnectionLostBanner } from "./ConnectionLostBanner";
import {
  getVisibleTiles,
  useBoardDragPan,
  useBoardSnap,
  useBoardViewport,
  useIdleReset,
  useUserPanSignal,
} from "./hooks/useBoard";
import { MINIMAP_LEFT, MINIMAP_TOP, MINIMAP_WIDTH, Minimap } from "./Minimap";
import { PlaceholderTile } from "./PlaceholderTile";
import { getTileModalEntry } from "./tiles/modals/registry";
import { TileModalHost } from "./tiles/modals/TileModalHost";
import type { TileModalEntry } from "./tiles/modals/types";
import { TileBoundary } from "./ui/TileBoundary";

// Interactive descendants a tap may land on (toggles, sliders, the Controls
// "More" button). Taps on these drive the tile's own controls and must NOT also
// open the detail modal; taps anywhere else on the tile open it.
const INTERACTIVE_SELECTOR = 'button, input, a, select, textarea, [role="slider"]';

// How close the viewport center must be to the home tile (Clock) center to count
// as "already home" — within this the idle reset is a no-op so it never nudges a
// view that's effectively already on the clock.
const HOME_DEADZONE_PX = 8;

// ─── snap-mode experiment (CC test) ──────────────────────────────────────────
// We're A/B-testing how the board should settle. Three of these are NATIVE CSS
// scroll-snap (browser does the momentum + snapping on the compositor thread —
// no JS spring to fight, so no Mac-trackpad jitter); "spring" is the legacy
// hand-rolled SmoothDamp magnetic snap, kept only so it can be compared head to
// head on-device. Once Calum picks a winner, delete the others + the switcher.
const SNAP_MODES = ["proximity", "mandatory", "mandatory-settle", "none", "spring"] as const;
type SnapMode = (typeof SNAP_MODES)[number];
const SNAP_MODE_KEY = "cc-board-snap-mode";
const SNAP_MODE_LABEL: Record<SnapMode, string> = {
  proximity: "snap: gentle",
  mandatory: "snap: paged",
  "mandatory-settle": "snap: paged+",
  none: "snap: off",
  spring: "snap: spring (old)",
};
// CSS scroll-snap-type per mode; "spring" disables native snap (JS drives it).
// "mandatory-settle" keeps native mandatory paging but ALSO runs the JS settle
// (see onSettle) as a safety net: iOS Safari only re-snaps after a momentum
// animation, so a zero-velocity finger lift leaves the page off-center — the
// settle springs it home. A flick still snaps natively (settle is a no-op then).
const SNAP_CSS: Record<SnapMode, string> = {
  proximity: "both proximity",
  mandatory: "both mandatory",
  "mandatory-settle": "both mandatory",
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

// World-pixel center of the home tile (the Clock). The board opens here and idles
// back here. Tiles are free-placed now, so "home" is wherever the home tile sits,
// not the geometric world center.
const HOME_RECT = tileWorldRect(HOME_TILE);
const HOME_CX = HOME_RECT.x + HOME_RECT.w / 2;
const HOME_CY = HOME_RECT.y + HOME_RECT.h / 2;

// First-render SEED only. vw/vh use the panel's target size as a placeholder;
// the useLayoutEffect below immediately overwrites left/top/vw/vh from the real
// (full-window) stage size before paint, so on any screen the board opens with
// the home tile (Clock) centered. Nothing here clips the view to BOARD_W×BOARD_H.
const INITIAL_VIEW = {
  left: HOME_CX - BOARD_W / 2,
  top: HOME_CY - BOARD_H / 2,
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
        top: 0,
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

// Git short SHA of the running web bundle, pinned bottom-left. The SHA is
// prefixed with '#' and trailed by a compact "time since commit" readout (e.g.
// "#a1b2c3d 10secs" → "3 days 3hrs") so you can tell at a glance both which
// build a wall panel is on and how stale it is. The age ticks once a minute.
function BuildHashBadge() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  const age = formatRelativeAge(BUILD_TIME, now);
  return (
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 12,
        fontFamily: "var(--mono)",
        fontSize: 11,
        letterSpacing: "-0.02em",
        color: "var(--ink-3)",
      }}
    >
      #{BUILD_HASH.slice(0, 7)}
      {age ? ` ${age}` : ""}
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

// Name of the tile currently under the viewport center, shown as a pill while
// you pan the board manually (mouse-drag or touch), then fading out like the
// minimap does. The minimap surfaces tile names on hover; this is the same
// affordance for plain panning, where there's no cursor over the map. Sits to
// the RIGHT of the minimap (mirroring the hover label) so it reads as part of
// the map and never overlaps it.
function CenteredTileLabel({ label, panSignal }: { label: string | undefined; panSignal: number }) {
  const [visible, setVisible] = useState(false);
  // Driven off `panSignal` exactly like the minimap: it bumps only on
  // user-driven scroll frames (see useUserPanSignal), so a manual pan re-shows
  // the label and resets the fade timer, while programmatic navigation (idle
  // reset, mount centering) never flashes it. 0 = no user pan yet.
  useEffect(() => {
    if (panSignal === 0) return;
    setVisible(true);
    const t = window.setTimeout(() => setVisible(false), 1500);
    return () => window.clearTimeout(t);
  }, [panSignal]);

  return (
    <div
      data-testid="centered-tile-label"
      style={{
        position: "absolute",
        // To the right of the minimap box, aligned with the minimap's hover
        // label (top: 6 inside the box, marginLeft: 6), so neither the map nor
        // this label ever obscures the other.
        left: MINIMAP_LEFT + MINIMAP_WIDTH + 6,
        top: MINIMAP_TOP + 6,
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
 * The pannable canvas board. Tiles are free-placed on a square world far larger
 * than the iPad viewport, on a square-cell lattice; the board opens centered on
 * the home tile (Clock) and idles back to it. Panning is native scroll (won the
 * pan-lab feel test) plus a desktop mouse-drag shim; only tiles near the viewport
 * are mounted (windowing). Zoom is fixed at 1:1 for now.
 *
 * Layout is driven entirely by TILE_REGISTRY via tileWorldRect — adding a tile
 * there places it on the world with no further changes here.
 */
export function Board() {
  const stageRef = useRef<HTMLDivElement>(null);
  const [activeModal, setActiveModal] = useState<TileModalEntry | null>(null);

  // Live-switchable settle feel (see SNAP_MODES). Persisted to localStorage.
  const [snapMode, setSnapMode] = useState<SnapMode>(loadSnapMode);
  useEffect(() => {
    try {
      window.localStorage?.setItem(SNAP_MODE_KEY, snapMode);
    } catch {
      // ignore — persistence is best-effort (blocked/full store)
    }
  }, [snapMode]);
  const cycleSnapMode = useCallback(() => {
    setSnapMode((m) => SNAP_MODES[(SNAP_MODES.indexOf(m) + 1) % SNAP_MODES.length]);
  }, []);

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

  // Whether a pointer is currently held down (touch or mouse). While held, the
  // user pans freely — no spring engages until they let go.
  const pointerDown = useRef(false);
  // Mouse-drag pan state. Created here (not inside useBoardDragPan) so the same
  // ref can be passed to both useBoardSnap (reads drag.current.active on settle)
  // and useBoardDragPan (writes the drag state on pointer events).
  const drag = useRef({ active: false, moved: false, x: 0, y: 0, sl: 0, st: 0 });

  // ── viewport tracking ──────────────────────────────────────────────────────
  const { view, syncView } = useBoardViewport(stageRef, INITIAL_VIEW);

  // User-vs-app movement discrimination: the minimap + centered-tile label key
  // their visibility off `panSignal`, which bumps only for scroll frames the
  // user caused. App-driven navigation (mount centering, idle reset) marks
  // itself programmatic so those glides never flash the chrome.
  const { panSignal, markProgrammatic, markUser, onScrollFrame } = useUserPanSignal();

  // Open centered on the home tile (Clock) using the real client size (pre-paint,
  // no flash). Programmatic: the browser echoes this write as a scroll event.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    markProgrammatic();
    stage.scrollLeft = HOME_CX - stage.clientWidth / 2;
    stage.scrollTop = HOME_CY - stage.clientHeight / 2;
    syncView();
  }, [syncView, markProgrammatic]);

  // rAF-throttle scroll → view state so the mounted-tile set tracks the pan
  // without a setState per scroll event.
  const rafRef = useRef(0);
  const onScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      syncView();
      onScrollFrame();
    });
  }, [syncView, onScrollFrame]);
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  // ── snap / spring ──────────────────────────────────────────────────────────
  const { springTo, cancelSnap, onSettle } = useBoardSnap({
    stageRef,
    snapMode,
    pointerDown,
    drag,
    cellAt,
  });

  // ── drag pan ───────────────────────────────────────────────────────────────
  const { suppressClick, onPointerDown, onPointerMove, endDrag } = useBoardDragPan({
    stageRef,
    drag,
    snapMode,
    snapCss: SNAP_CSS,
    modalOpenRef,
    pointerDown,
    cancelSnap,
    onSettle,
  });

  // A press (touch/mouse) or wheel tick is the user grabbing the board — it
  // reclaims the scroll stream even mid-way through a programmatic glide, so
  // the pan chrome reappears the instant they take over.
  const onStagePointerDown = useCallback(
    (e: React.PointerEvent) => {
      markUser();
      onPointerDown(e);
    },
    [markUser, onPointerDown],
  );

  // Glide the camera so `entry` lands dead center, reusing the snap spring (same
  // SmoothDamp feel as settle-snapping) instead of a separate animation. Opening
  // a modal freezes native pan (overflow:hidden on the stage), but an
  // overflow:hidden element is still a *programmatic* scroll container, so these
  // scrollLeft/Top writes keep driving the glide to completion behind the modal.
  const snapModeRef = useRef(snapMode);
  useEffect(() => {
    snapModeRef.current = snapMode;
  }, [snapMode]);

  const glideToTile = useCallback(
    (entry: TileRegistryEntry) => {
      const stage = stageRef.current;
      if (!stage) return;
      // A tap/keyboard recenter is the user moving the board.
      markUser();
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
    [springTo, markUser],
  );

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

  // The minimap's jumps are user gestures (click/scrub on the map): their
  // scroll frames must show the pan chrome, unlike goHome's below.
  const userJump = useCallback(
    (worldX: number, worldY: number, smooth: boolean) => {
      markUser();
      jumpTo(worldX, worldY, smooth);
    },
    [jumpTo, markUser],
  );

  // After an idle window with no interaction, glide back to the home tile (Clock)
  // via the same smooth nav the minimap uses — so an unattended wall panel
  // resettles on the clock. goHome/isHome read the live scroll position; the hook
  // owns the timer + interaction listeners. The glide is app-initiated, so it is
  // marked programmatic and never re-shows the minimap (www-5teu).
  const goHome = useCallback(() => {
    markProgrammatic();
    jumpTo(HOME_CX, HOME_CY, true);
  }, [jumpTo, markProgrammatic]);
  const isHome = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return true;
    const cx = stage.scrollLeft + stage.clientWidth / 2;
    const cy = stage.scrollTop + stage.clientHeight / 2;
    return Math.hypot(cx - HOME_CX, cy - HOME_CY) < HOME_DEADZONE_PX;
  }, []);
  useIdleReset({ stageRef, goHome, isHome, pointerDown });

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

  // Any click within a tile recenters the camera on that tile — even taps that
  // land on an inner control (toggle/slider/button) or on a self-tapping tile
  // (Controls). Runs in the capture phase (wired via onClickCapture) so an inner
  // stopPropagation — e.g. the Controls body tap — can't swallow the recenter.
  // The modal still opens only for a "plain" tap: a self-tapping tile runs its
  // own UI and a tap on a control drives that control, so neither also opens the
  // board's detail modal.
  function onTileClickCapture(entry: TileRegistryEntry, e: React.MouseEvent<HTMLDivElement>) {
    // Freeze the board while ANY modal is open. The shared <Modal> portals to
    // <body>, but in the React tree it is still a descendant of this tile
    // wrapper, so React replays clicks inside the modal up into this capture
    // handler. Without this bail a tap on a modal control (e.g. the Controls
    // party/scene buttons) would call glideToTile → a fresh smooth scrollTo of
    // the board behind the backdrop, so rapid taps visibly jitter the
    // background. native scroll + drag-pan are already frozen on modalOpen; this
    // closes the same hole for the programmatic click→glide path.
    if (modalOpen) return;
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

  // One windowed list for the whole board: real tiles and placeholders alike.
  const visibleCells = getVisibleTiles(BOARD_CELLS, view);

  // The cell under the viewport crosshair (world-space center of the view).
  // Updates every scroll frame via `view`; null when the center lands in a gap.
  const centerX = view.left + view.vw / 2;
  const centerY = view.top + view.vh / 2;
  const centered = cellAt(centerX, centerY);
  const centeredId = centered?.id;
  // Label for the centered cell (bento fill has no entry → undefined), surfaced
  // top-left while panning.
  const centeredLabel = centered?.entry?.label;

  return (
    <div
      id="stage"
      ref={stageRef}
      onScroll={onScroll}
      onPointerDown={onStagePointerDown}
      onWheel={markUser}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      // pointercancel fires when the OS steals the touch (edge/system gesture,
      // multi-touch). Without this the held-pointer ref sticks true, which would
      // freeze drag-pan AND permanently disable the idle reset (it never fires
      // mid-interaction). Ending the drag here clears that ref on the panel.
      onPointerCancel={endDrag}
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
        <CenteredTileLabel label={centeredLabel} panSignal={panSignal} />
        <Minimap
          view={view}
          panSignal={panSignal}
          // Both layers derive from the one BOARD_CELLS list: real tiles (with a
          // label) and placeholder ghosts (no entry). flatMap narrows `entry`.
          tiles={BOARD_CELLS.flatMap((c) => (c.entry ? [{ ...c.rect, label: c.entry.label }] : []))}
          ghosts={BOARD_CELLS.flatMap((c) => (c.entry ? [] : [c.rect]))}
          onJump={userJump}
        />
      </div>
      <TileModalHost entry={activeModal} onClose={() => setActiveModal(null)} />
    </div>
  );
}
