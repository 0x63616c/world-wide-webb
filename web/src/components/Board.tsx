import { QueryErrorResetBoundary } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BUILD_HASH, BUILD_TIME } from "../config/build";
import { getInstalledBuildNumber } from "../lib/app-update";
import {
  attachCamera,
  type BoardCameraHost,
  boardCamera,
  cameraCancel,
  cameraJumpTo,
  cameraSettle,
  SNAP_CSS,
} from "../lib/board-camera";
import { dimTo, isNativeDisplay, wakeTo } from "../lib/brightness";
import {
  BOARD_H,
  BOARD_W,
  tileWorldRect,
  WORLD_H,
  WORLD_W,
  worldCellRect,
} from "../lib/grid-constants";
import { useLayoutEditorOpen } from "../lib/layout-edit-store";
import {
  endInteractionSession,
  interaction,
  startInteractionSession,
} from "../lib/log/interaction";
import { dismissAllModals, useAnyModalOpen } from "../lib/modal-open-store";
import { panelSession, registerSessionEffects, setSessionEnabled } from "../lib/panel-session";
import { bentoFor } from "../lib/placeholder-tiles";
import { formatRelativeAge } from "../lib/relative-age";
import { useSettings } from "../lib/settings";
import { closeTileDetail, openTileDetail } from "../lib/tile-detail-store";
import { HOME_TILE, type TileRegistryEntry } from "../lib/tile-registry";
import { useBoardLayout } from "../lib/useBoardLayout";
import { captureWakeBurst } from "../lib/wake-capture";
import { AppUpdateBanner } from "./AppUpdateBanner";
import { ConnectionLostBanner } from "./ConnectionLostBanner";
import { DeviceNameBanner } from "./DeviceNameBanner";
import { FpsSparkline } from "./FpsSparkline";
import {
  getVisibleTiles,
  useBoardDragPan,
  useBoardSnap,
  useBoardViewport,
  useUserPanSignal,
} from "./hooks/useBoard";
import { LayoutEditor } from "./layout-editor/LayoutEditor";
import { MINIMAP_LEFT, MINIMAP_TOP, MINIMAP_WIDTH, Minimap } from "./Minimap";
import { NotChargingBanner } from "./NotChargingBanner";
import { PlaceholderTile } from "./PlaceholderTile";
import { SettingsButton } from "./SettingsButton";
import { TimeSuiteBanner } from "./TimeSuiteBanner";
import { getTileDetailEntry } from "./tiles/detail/registry";
import { TileDetailHost } from "./tiles/detail/TileDetailHost";
import { NotificationBanner, NotificationBannerStack } from "./ui/NotificationBanner";
import { TileBoundary } from "./ui/TileBoundary";

// Interactive descendants a tap may land on (toggles, sliders, the Controls
// "More" button). Taps on these drive the tile's own controls and must NOT also
// open the detail page; taps anywhere else on the tile open it.
const INTERACTIVE_SELECTOR = 'button, input, a, select, textarea, [role="slider"]';

// The snap-mode CSS map + JS spring physics moved to lib/board-camera; SNAP_CSS
// is imported above (the board-rendering half of the snap-mode experiment).

type Rect = { x: number; y: number; w: number; h: number };

// One cell on the board's world lattice. A cell WITH an `entry` is a real,
// interactive tile (mounts its component, opens a modal + recenters on tap); a
// cell WITHOUT one is decorative bento fill (inert, pointer-transparent). Both
// share identical geometry, so the board positions, windows, snaps, highlights,
// and centers them through this one shape , there is no separate placeholder
// render path. Placeholders genuinely have no component/label and live on
// world-absolute coords, so they stay out of the registry; the two sources
// merge HERE into the single list everything downstream consumes.
type BoardCell = { id: string; rect: Rect; entry?: TileRegistryEntry };

// The cell whose rect contains world point (cx, cy), or undefined in a gap.
// Real tiles and placeholders never overlap, so the first match is unambiguous.
// Takes the live `cells` list (server-resolved layout) as a parameter rather
// than closing over a module-load const, since tile placement is no longer
// fixed at module load (see useBoardLayout).
function cellAt(cells: BoardCell[], cx: number, cy: number): BoardCell | undefined {
  return cells.find(
    ({ rect }) => cx >= rect.x && cx <= rect.x + rect.w && cy >= rect.y && cy <= rect.y + rect.h,
  );
}

// First-render SEED only, used before the layout has resolved (loading stage
// renders no tiles at all, so the exact value here never shows). BOARD_W/H
// center it well enough for the one frame it might be visible during the
// useLayoutEffect below, which overwrites left/top/vw/vh from the real
// (full-window) stage size once the home tile's resolved position is known.
const INITIAL_VIEW = { left: 0, top: 0, vw: BOARD_W, vh: BOARD_H };

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
// A subtle sparkline of the last 60s (120 samples at 2/sec) sits beneath the
// number so a momentary stutter is visible after it has passed.
function FpsMeter() {
  const [fps, setFps] = useState(0);
  const [samples, setSamples] = useState<number[]>([]);
  useEffect(() => {
    let raf = 0;
    let frames = 0;
    let last = performance.now();
    const loop = (now: number) => {
      frames++;
      if (now - last >= 500) {
        const fpsValue = Math.round((frames * 1000) / (now - last));
        setFps(fpsValue);
        // 120 samples × 500ms = 60s of history; sampled twice a second, not per
        // rAF frame, so the array stays small and the sparkline stays legible.
        setSamples((s) => [...s, fpsValue].slice(-120));
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
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 2,
        fontFamily: "var(--mono)",
        fontSize: 11,
        letterSpacing: "-0.02em",
        color: "var(--ink-3)",
      }}
    >
      <span>{fps} fps</span>
      <FpsSparkline samples={samples} />
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

// Installed native app build number (CFBundleVersion), pinned bottom-left one
// line ABOVE the git-sha BuildHashBadge so the two stack without overlapping.
// Native-only: getInstalledBuildNumber resolves null in a plain browser
// (dev/Storybook), where this renders nothing.
function BuildNumberBadge() {
  const [build, setBuild] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getInstalledBuildNumber().then((b) => {
      if (!cancelled) setBuild(b);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  if (build === null) return null;
  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        left: 12,
        fontFamily: "var(--mono)",
        fontSize: 11,
        letterSpacing: "-0.02em",
        color: "var(--ink-3)",
      }}
    >
      build {build}
    </div>
  );
}

// Full-screen shimmer stage, shown in place of the board while the first
// `layout.get` is in flight — no tiles, no fake data, just the shared skeleton
// shimmer gradient (same animation as <Skeleton>) over the board background.
function BoardLoadingStage() {
  return (
    <div
      data-testid="board-loading"
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--bg)",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(90deg, var(--tile-2) 25%, var(--nest) 50%, var(--tile-2) 75%)",
          backgroundSize: "200%",
          animation: "shimmer 1.6s linear infinite",
          opacity: 0.5,
        }}
      />
    </div>
  );
}

// Fixed banner (same visual language as ConnectionLostBanner, one slot below
// AppUpdateBanner) shown when the resolved layout couldn't place every tile ,
// e.g. a newly-registered tile with no free space. Points the operator at the
// editor rather than silently dropping the tile.
function UnplacedTilesBanner({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <NotificationBanner tone="amber">
      New tile has no space — edit layout to place it
    </NotificationBanner>
  );
}

// How long the shield lingers after the wake tap if no click ever arrives to
// release it (pointer cancelled mid-tap, stylus hover, etc.). Long enough for
// any synthesized click, short enough to never eat a deliberate second tap.
const DIM_LINGER_MAX_MS = 500;

// Invisible full-screen shield, rendered only while the panel is dimmed. Idle
// dimming is native-only (gated off isNativeDisplay in Board), and on the iPad
// the screen-brightness plugin drops the real backlight , so there is nothing to
// paint here. This layer exists purely to CAPTURE the wake tap: the first touch
// lands here (never on a tile), calls onWake to brighten + rearm the idle
// windows, and is swallowed , so the next tap is the first that actually
// interacts. Off-device the feature is inert, so this never renders active.
function DimOverlay({ active, onWake }: { active: boolean; onWake: () => void }) {
  // The wake tap flips `active` off on pointerdown, but the browser synthesizes
  // the tap's `click` AFTER pointerup , if the shield unmounted with `active`,
  // that click would retarget to whatever tile sits under the finger, so the
  // "swallowed" wake tap opened a modal anyway. Linger until the tap's click
  // has been absorbed here (or a short fallback), then unmount.
  const [lingering, setLingering] = useState(false);
  const fallbackRef = useRef<number | null>(null);

  const release = useCallback(() => {
    if (fallbackRef.current !== null) window.clearTimeout(fallbackRef.current);
    fallbackRef.current = null;
    setLingering(false);
  }, []);

  // Never leak the fallback timer on unmount.
  useEffect(
    () => () => {
      if (fallbackRef.current !== null) window.clearTimeout(fallbackRef.current);
    },
    [],
  );

  if (!active && !lingering) return null;
  // Portalled to <body> at a zIndex above every modal (Modal 100, Level 200,
  // CleanScreen 300). Rendered inside the board it sat UNDER anything portalled
  // to body, so a wake tap on an open modal hit the modal instead of this shield
  // , the panel could not be woken from inside a modal at all.
  return createPortal(
    <div
      aria-hidden="true"
      data-testid="dim-overlay"
      onPointerDown={(e) => {
        e.preventDefault();
        if (active) {
          onWake();
          setLingering(true);
          fallbackRef.current = window.setTimeout(release, DIM_LINGER_MAX_MS);
        }
      }}
      onClick={(e) => {
        // The wake tap's own click ends the linger; a click while still dimmed
        // (active) is just swallowed like the pointerdown was.
        e.preventDefault();
        if (!active) release();
      }}
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "auto",
        zIndex: 400,
      }}
    />,
    document.body,
  );
}

// Mounts <LayoutEditor/> (which reads its own open/closed state off the same
// store) while animating its entrance: a plain opacity/scale mount would snap
// straight to its final state (no transition plays on first paint), so this
// defers the "entered" flip to a rAF after mount, giving the browser one frame
// at the starting values to transition FROM. Unmounts immediately on close ,
// only the entrance needs to feel soft, per the binding decision (full-screen
// overlay, no pan while editing).
function LayoutEditorOverlay({ open }: { open: boolean }) {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    if (!open) {
      setEntered(false);
      return;
    }
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, [open]);

  if (!open) return null;

  // This wrapper is itself the fixed, viewport-filling box. Its transform (even
  // the settled scale(1)) makes it the containing block for LayoutEditor's own
  // `fixed inset: 0` chrome, so it must have real viewport size — an in-flow,
  // auto-height wrapper would resolve that inset against a 0-height box and
  // collapse the editor stage.
  return (
    <div
      data-testid="layout-editor-overlay-wrapper"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        opacity: entered ? 1 : 0,
        transform: entered ? "scale(1)" : "scale(0.98)",
        transition: "opacity 200ms ease, transform 200ms ease",
      }}
    >
      <LayoutEditor />
    </div>
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
 * Layout is driven by the server-resolved placement (useBoardLayout →
 * resolveLayout, Task 5/6): tile position comes from a saved placement when one
 * exists, else the registry default, adding a tile to the registry places it
 * on the world with no further changes here.
 */
export function Board() {
  const stageRef = useRef<HTMLDivElement>(null);
  // The stage as STATE as well as a ref. The stage is gated behind the
  // layout-loading screen below, so it mounts on a later commit than this
  // component: effects that must attach listeners to it (the idle timers) need
  // a dep that actually changes when it arrives, which a stable ref never does.
  // The callback ref keeps both in lockstep.
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null);
  const setStage = useCallback((el: HTMLDivElement | null) => {
    stageRef.current = el;
    setStageEl(el);
  }, []);

  // Live settings (idle-dim behavior, FPS readout, snap-mode) from the shared
  // store. Edits made in the settings panel apply here with no prop-drilling;
  // snapMode replaces the old localStorage-backed useState.
  const settings = useSettings();
  const snapMode = settings.snapMode;
  // Idle dimming is native-only: off-device (browser/Storybook) there is no
  // backlight to drop, so the whole feature is a no-op rather than a CSS scrim.
  const nativeDisplay = isNativeDisplay();

  // Whether the layout editor overlay is open (Task 7's store; entry is the
  // settings panel's "Edit layout" row). While open the board itself is fully
  // frozen — see the modalOpen OR-chain, idle hooks' `enabled`, and the hidden
  // chrome below — and its own layout poll pauses (the editor stages its own
  // working copy, so a background refetch here is redundant work).
  const layoutEditOpen = useLayoutEditorOpen();

  // The panel session's current phase. "ended" = the idle timeout elapsed:
  // the panel is dimmed, relocked, and homed. Drives the DimOverlay wake shield
  // and the backlight below.
  const sessionPhase = panelSession.usePhase();

  // Server-resolved tile placement (blocking first paint + 5s poll, see
  // useBoardLayout). `layoutStatus` gates the loading-stage render below; every
  // hook past this point still runs unconditionally (rules of hooks) and simply
  // operates on the fallback (registry-default) layout until the first settle,
  // which is never shown — the loading stage covers the whole screen.
  const { status: layoutStatus, layout } = useBoardLayout({ enabled: !layoutEditOpen });

  // The single source of truth for every cell this render. Placeholders come
  // FIRST so they paint BENEATH the real tiles (DOM order = paint order); real
  // tiles overlay. Regenerates only when the resolved tile set changes (a saved
  // placement moved, or the poll picked up an edit from another device).
  const boardCells: BoardCell[] = useMemo(() => {
    const bento = bentoFor(
      layout.tiles.map((t) => ({ col: t.worldCol, row: t.worldRow, cols: t.cols, rows: t.rows })),
    );
    return [
      ...bento.map((b) => ({ id: b.id, rect: worldCellRect(b.col, b.row, b.cols, b.rows) })),
      ...layout.tiles.map((entry) => ({ id: entry.id, rect: tileWorldRect(entry), entry })),
    ];
  }, [layout.tiles]);

  const cellAtPoint = useCallback(
    (cx: number, cy: number) => cellAt(boardCells, cx, cy),
    [boardCells],
  );

  // World-pixel center of the home tile (the Clock). The board opens here and
  // idles back here. Tiles are free-placed, so "home" is wherever the home
  // tile's RESOLVED position sits (its registry default until a saved
  // placement moves it), not the geometric world center. Falls back to the
  // registry's HOME_TILE rect if the resolved list doesn't have it yet (only
  // during the loading stage, which never renders tiles anyway).
  const homeEntry = useMemo(
    () => layout.tiles.find((t) => t.id === HOME_TILE.id) ?? HOME_TILE,
    [layout.tiles],
  );
  const homeRect = useMemo(() => tileWorldRect(homeEntry), [homeEntry]);
  const homeCx = homeRect.x + homeRect.w / 2;
  const homeCy = homeRect.y + homeRect.h / 2;

  // Mirrors modal-open state into a ref so the memoized pointer handlers can bail
  // without being re-created. While an overlay is open the board must NOT pan: a
  // press outside it hits the overlay's own backdrop/chrome, and native scroll is
  // frozen via the stage style below.
  //
  // `useAnyModalOpen()` covers every overlay that registers with
  // modal-open-store: the full-page tile detail (TileDetailHost), Settings, and
  // any modal a tile manages on its own, whose portaled backdrop would otherwise
  // replay presses up the React tree into this stage's drag-pan. The layout
  // editor is a full-screen overlay too (no pan while editing, per the binding
  // decision), so it joins the same freeze chain.
  const anyModalOpen = useAnyModalOpen();
  const modalOpen = anyModalOpen || layoutEditOpen;
  const modalOpenRef = useRef(modalOpen);
  useEffect(() => {
    modalOpenRef.current = modalOpen;
  }, [modalOpen]);

  // Whether a pointer is currently held down (touch or mouse). While held, the
  // user pans freely , no spring engages until they let go.
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: layoutStatus is a deliberate extra dep — see the comment at the bottom of this effect.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    markProgrammatic();
    stage.scrollLeft = homeCx - stage.clientWidth / 2;
    stage.scrollTop = homeCy - stage.clientHeight / 2;
    syncView();
    // Re-centers whenever the resolved home position changes — covers both the
    // loading→ready transition (default seed → resolved position, before the
    // shimmer lifts) and a later poll that moves the home tile. `layoutStatus`
    // is in the deps because the stage div itself is unmounted during loading
    // (see the shimmer branch below) — without it, a ready-render whose
    // homeCx/homeCy happen to numerically match the loading-render's defaults
    // (e.g. empty saved layout, resolveLayout([]) both times) would leave this
    // effect's deps unchanged, so it would never re-run and the now-mounted
    // stage would stay uncentered at (0, 0).
  }, [syncView, markProgrammatic, homeCx, homeCy, layoutStatus]);

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

  // ── board-camera binding ─────────────────────────────────────────────────────
  // The camera singleton (lib/board-camera) owns the spring physics + glide/pan/
  // home moves; it reads the live snap mode, home position, tile/cell layout, and
  // pointer state through this host. Kept as render-updated refs so the camera
  // always sees current values without the attach effect re-running each render.
  const snapModeRef = useRef(snapMode);
  snapModeRef.current = snapMode;
  const homeRef = useRef({ cx: homeCx, cy: homeCy });
  homeRef.current = { cx: homeCx, cy: homeCy };
  const cellAtRef = useRef(cellAtPoint);
  cellAtRef.current = cellAtPoint;
  const layoutTilesRef = useRef(layout.tiles);
  layoutTilesRef.current = layout.tiles;

  useEffect(() => {
    if (!stageEl) return;
    return attachCamera({
      stage: stageEl,
      snapMode: () => snapModeRef.current,
      home: () => homeRef.current,
      tileCenter: (id) => {
        const t = layoutTilesRef.current.find((x) => x.id === id);
        if (!t) return undefined;
        const r = tileWorldRect(t);
        return { cx: r.x + r.w / 2, cy: r.y + r.h / 2 };
      },
      cellAt: (x, y) => cellAtRef.current(x, y),
      interacting: () => pointerDown.current || drag.current.active,
      markUser,
      markProgrammatic,
    } satisfies BoardCameraHost);
  }, [stageEl, markUser, markProgrammatic]);

  // ── snap / spring ──────────────────────────────────────────────────────────
  // Wires the camera's magnetic settle to scrollend + cancels on unmount; the
  // spring itself lives in the camera now (see the host binding above).
  useBoardSnap({ stageRef });

  // ── drag pan ───────────────────────────────────────────────────────────────
  const { suppressClick, onPointerDown, onPointerMove, endDrag } = useBoardDragPan({
    stageRef,
    drag,
    snapMode,
    snapCss: SNAP_CSS,
    modalOpenRef,
    pointerDown,
    cancelSnap: cameraCancel,
    onSettle: cameraSettle,
  });

  // A press (touch/mouse) or wheel tick is the user grabbing the board , it
  // reclaims the scroll stream even mid-way through a programmatic glide, so
  // the pan chrome reappears the instant they take over.
  const onStagePointerDown = useCallback(
    (e: React.PointerEvent) => {
      markUser();
      onPointerDown(e);
    },
    [markUser, onPointerDown],
  );

  // Glide the camera so `entry` lands dead center. Delegates to the camera's
  // panTo (spring in spring-mode, native smooth otherwise), which also marks the
  // move user-driven. Opening a modal freezes native pan (overflow:hidden on the
  // stage), but an overflow:hidden element is still a *programmatic* scroll
  // container, so a spring-mode glide keeps driving behind the modal.
  const glideToTile = useCallback((entry: TileRegistryEntry) => {
    const rect = tileWorldRect(entry);
    boardCamera.panTo({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });
  }, []);

  // The minimap's jumps are user gestures (click/scrub on the map): their
  // scroll frames must show the pan chrome, unlike goHome's below. cameraJumpTo
  // is the native scroll-to-center (clamped to range); each smooth frame fires
  // onScroll → keeps the minimap alive through it.
  const userJump = useCallback(
    (worldX: number, worldY: number, smooth: boolean) => {
      markUser();
      // Only the USER-initiated jump is logged, never the camera jump itself ,
      // goHome drives the same move on an idle timer, and an app-initiated glide
      // is not something a person did.
      interaction("nav", "jump", "minimap", {
        worldX: Math.round(worldX),
        worldY: Math.round(worldY),
      });
      cameraJumpTo(worldX, worldY, smooth);
    },
    [markUser],
  );

  // ── panel session ────────────────────────────────────────────────────────────
  // ONE activity clock (lib/panel-session) replaces the old idle-reset + idle-dim
  // timers. Touch is the only activity source; on the idle timeout a single
  // SESSION END fires (dim → strip overlays → glide home → relock). Native only:
  // the dim drops the real iPad backlight, so off-device the whole session is
  // inert (no scrim, no auto-lock) , matching the old idle-dim gate. Disabled
  // while the layout editor is open (an idle glide-home / dim mid-edit would
  // fight the editor's own camera and obscure what's being arranged).
  const sessionEnabled = settings.idleDimEnabled && nativeDisplay && !layoutEditOpen;

  // Feed the clock: the (in-place-renamed) idle-dim timeout is THE session
  // timeout. Stop the clock on unmount so a torn-down Board never ends a session.
  useEffect(() => {
    panelSession.setTimeoutMs(settings.idleDimTimeoutMs);
  }, [settings.idleDimTimeoutMs]);
  useEffect(() => {
    setSessionEnabled(sessionEnabled);
    return () => setSessionEnabled(false);
  }, [sessionEnabled]);

  // The session-end fan-out (dim + strip overlays + glide home), registered once.
  // The dim level is read live through a ref so a settings change is picked up
  // without re-registering. glideHome is fire-and-forget (native smooth scroll);
  // "strip overlays" means the wall returns to a clean board , gliding home
  // behind an open Settings panel would leave the panel up indefinitely.
  const dimLevelRef = useRef(settings.idleDimLevel);
  dimLevelRef.current = settings.idleDimLevel;
  useEffect(
    () =>
      registerSessionEffects({
        dim: () => {
          if (nativeDisplay) void dimTo(dimLevelRef.current);
        },
        closeTileDetail: () => closeTileDetail(),
        clearModals: () => dismissAllModals(),
        glideHome: () => boardCamera.glideHome(),
      }),
    [nativeDisplay],
  );
  // The wall going quiet ends the visit: close the interaction session at the
  // moment the panel actually gave up (so the transcript's closing entry carries
  // the real reason), not a whole idle window later.
  useEffect(() => panelSession.onSessionEnd(() => endInteractionSession("session-end")), []);

  // The single activity source: any user touch rearms the clock. While the
  // session is ended the DimOverlay shield is the ONLY waker (it swallows the tap
  // and calls wake()); a raw listener firing here would wake mid-dispatch and let
  // the tap fall through to a tile, so ended touches are ignored here (the
  // window-capture listener sees the tap before the shield's own handler).
  useEffect(() => {
    const onActivity = () => {
      if (panelSession.phase() === "ended") return;
      panelSession.touch();
    };
    window.addEventListener("pointerdown", onActivity, { passive: true, capture: true });
    return () => window.removeEventListener("pointerdown", onActivity, { capture: true });
  }, []);

  // The app always owns the backlight (overriding the OS). While the session is
  // active (incl. mount) hold the configured active brightness; the session-end
  // fan-out drops it to the idle level and waking returns it here. Native only.
  useEffect(() => {
    if (!nativeDisplay) return;
    if (sessionPhase === "active") void wakeTo(settings.activeBrightness);
  }, [sessionPhase, nativeDisplay, settings.activeBrightness]);
  // Never leave the backlight dimmed if the board unmounts mid-session , read the
  // live active brightness through a ref so the once-only cleanup uses the latest.
  const activeBrightnessRef = useRef(settings.activeBrightness);
  activeBrightnessRef.current = settings.activeBrightness;
  useEffect(() => () => void wakeTo(activeBrightnessRef.current), []);

  const wake = useCallback(() => {
    // The tap that ends a dim is the "someone approached the panel" signal, so
    // kick off the front-camera wake burst (fire-and-forget, best-effort , see
    // lib/wake-capture). Order matters: mint the session FIRST so the burst's
    // frames can carry it. An undim is the physical start of a visit, so it opens
    // a new session outright rather than resuming.
    const sessionId = startInteractionSession();
    if (nativeDisplay) captureWakeBurst(sessionId);
    interaction("session", "wake", "panel");
    // touch() wakes the session (ended → active) and rearms the clock; the
    // backlight effect above brightens off the phase flip.
    panelSession.touch();
  }, [nativeDisplay]);

  // Recenter + open the tile's detail, kicked off together. Shared by the
  // plain-tap and keyboard activation paths. Every tile resolves through the
  // detail registry: a "page" entry opens its full-page detail, an "action"
  // entry (Frontend Logs) runs its deep link instead of opening a page.
  const activateTile = useCallback(
    (entry: TileRegistryEntry) => {
      glideToTile(entry);
      const detail = getTileDetailEntry(entry.id);
      if (!detail) return;
      if (detail.kind === "action") detail.run();
      else openTileDetail(entry.id);
    },
    [glideToTile],
  );

  // Any click within a tile recenters the camera on that tile , even taps that
  // land on an inner control (toggle/slider/button). Runs in the capture phase
  // (wired via onClickCapture) so an inner stopPropagation can't swallow the
  // recenter. The detail page still opens only for a "plain" tap: a tap on a
  // control drives that control, so it doesn't also open the tile's detail page.
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
    // Interaction log: one capture-phase handler is the single place every tile
    // tap passes through, so all 17 tiles (and any tile added later) are covered
    // without touching a tile component. `kind` records what the tap actually
    // did, which is the difference between "they poked a tile's inner control"
    // and "they opened the detail page" , indistinguishable from the tile id
    // alone.
    // A tile's whole face opens its detail page; inner controls own their taps
    // via INTERACTIVE_SELECTOR.
    const controlTap = Boolean((e.target as HTMLElement).closest(INTERACTIVE_SELECTOR));
    interaction("tile", "tap", entry.id, {
      label: entry.label,
      kind: controlTap ? "control" : "open-detail",
    });
    if (controlTap) {
      glideToTile(entry);
      return;
    }
    activateTile(entry);
  }

  // One windowed list for the whole board: real tiles and placeholders alike.
  const visibleCells = getVisibleTiles(boardCells, view);

  // The cell under the viewport crosshair (world-space center of the view).
  // Updates every scroll frame via `view`; null when the center lands in a gap.
  const centerX = view.left + view.vw / 2;
  const centerY = view.top + view.vh / 2;
  const centered = cellAtPoint(centerX, centerY);
  const centeredId = centered?.id;
  // Label for the centered cell (bento fill has no entry → undefined), surfaced
  // top-left while panning.
  const centeredLabel = centered?.entry?.label;

  // Blocking first paint: the layout hasn't settled (success OR error) yet, so
  // no tile geometry is trustworthy — render the shimmer stage only. Every hook
  // above still ran (rules of hooks), it just drives a screen nobody sees.
  if (layoutStatus === "loading") return <BoardLoadingStage />;

  return (
    <>
      <div
        id="stage"
        ref={setStage}
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
            Placeholders sort first in boardCells so they paint underneath. */}
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
                  // Enter/Space open the tile's detail page like a plain tap
                  // would; keys inside inner controls stay theirs.
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    activateTile(entry);
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
          {/* One top-right column: banners flow top-down in priority order and
            pack tight against the corner, so a lower-priority banner showing
            alone never leaves an empty slot above it. Tapping any banner opens
            the Notification Center and nothing else (see NotificationBanner). */}
          <NotificationBannerStack>
            <DeviceNameBanner />
            <ConnectionLostBanner />
            <AppUpdateBanner />
            <UnplacedTilesBanner count={layout.unplaced.length} />
            <NotChargingBanner />
            {/* Also what BOOTS the time suite: importing it evaluates the
              timer/alarm stores, so deploy-reload boot-resume runs at app
              start with the clock page closed. */}
            <TimeSuiteBanner />
          </NotificationBannerStack>
          {settings.showFps ? <FpsMeter /> : null}
          {settings.showBuildBadge ? <BuildHashBadge /> : null}
          {settings.showBuildNumber ? <BuildNumberBadge /> : null}
          {/* Hidden while the layout editor is open: it's a full-screen overlay
            with its own camera/chrome, and none of these read on a frozen board
            underneath it. */}
          {layoutEditOpen ? null : <SettingsButton />}
          {/* Minimap + its centered-tile label are one visual unit (the label is
            positioned relative to the minimap box and reads as part of it), so
            the showMinimap setting gates both together. */}
          {layoutEditOpen || !settings.showMinimap ? null : (
            <CenteredTileLabel label={centeredLabel} panSignal={panSignal} />
          )}
          {layoutEditOpen || !settings.showMinimap ? null : (
            <Minimap
              view={view}
              panSignal={panSignal}
              // Both layers derive from the one boardCells list: real tiles (with a
              // label) and placeholder ghosts (no entry). flatMap narrows `entry`.
              tiles={boardCells.flatMap((c) =>
                c.entry ? [{ ...c.rect, label: c.entry.label }] : [],
              )}
              ghosts={boardCells.flatMap((c) => (c.entry ? [] : [c.rect]))}
              onJump={userJump}
            />
          )}
        </div>
        {/* Idle dim tap-shield (native only). Sits above the board + its chrome but
          below modals (which portal to <body>) so it swallows the wake tap. */}
        <DimOverlay active={sessionPhase === "ended"} onWake={wake} />
        {/* Full-page detail path (store-driven). Registers with modal-open-store,
          so the existing modalOpen freeze/bail logic covers it automatically. */}
        <TileDetailHost />
      </div>
      {/* Mounted as a sibling of #stage, NOT a descendant — #stage is the native
        scroll container (scrollLeft/Top drive panning), and per spec any
        transformed ancestor becomes the containing block for position:fixed
        descendants. LayoutEditorOverlay's own entrance-animation wrapper sets
        `transform: scale(...)`, so nesting it inside #stage would pin
        LayoutEditor's internal fixed chrome to that wrapper's in-flow box —
        which sits at #stage's current (board-world) scroll offset, i.e.
        completely offscreen. Living outside #stage entirely sidesteps the
        issue regardless of #stage's scroll position. */}
      <LayoutEditorOverlay open={layoutEditOpen} />
    </>
  );
}
