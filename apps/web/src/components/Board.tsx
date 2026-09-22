import { getTileDetailEntry, type TileRegistryEntry } from "@features/_generated/web.gen";
import { genId } from "@www/platform";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { resolveLayout } from "../lib/board-layout";
import { dimTo, isNativeDisplay, wakeTo } from "../lib/brightness";
import {
  BOARD_H,
  BOARD_W,
  tileWorldRect,
  WORLD_H,
  WORLD_W,
  worldCellRect,
} from "../lib/grid-constants";
import { dismissAllModals, useAnyModalOpen } from "../lib/modal-open-store";
import { panelSession, registerSessionEffects, setSessionEnabled } from "../lib/panel-session";
import { bentoFor } from "../lib/placeholder-tiles";
import { ACTIVE_BRIGHTNESS, IDLE_DIM_LEVEL, IDLE_DIM_TIMEOUT_MS } from "../lib/settings";
import { closeTileDetail, openTileDetail } from "../lib/tile-detail-store";
import { captureWakeBurst } from "../lib/wake-capture";
import { ConnectionLostBanner } from "./ConnectionLostBanner";
import { DeviceNameBanner } from "./DeviceNameBanner";
import { type BoardView, getVisibleTiles } from "./hooks/useBoard";
import { Icon } from "./Icon";
import { PlaceholderTile } from "./PlaceholderTile";
import { SettingsButton } from "./SettingsButton";
import { TileDetailHost } from "./tiles/detail/TileDetailHost";
import { UpdateReloadBanner } from "./UpdateReloadBanner";
import { BoundedTile } from "./ui/BoundedTile";
import { NotificationBanner, NotificationBannerStack } from "./ui/NotificationBanner";

// Interactive descendants a tap may land on (toggles, sliders, the Controls
// "More" button). Taps on these drive the tile's own controls and must NOT also
// open the detail page; taps anywhere else on the tile open it.
const INTERACTIVE_SELECTOR = 'button, input, a, select, textarea, [role="slider"]';

type Rect = { x: number; y: number; w: number; h: number };

// One cell on the board's world lattice. A cell WITH an `entry` is a real,
// interactive tile (mounts its component and opens its detail on tap); a
// cell WITHOUT one is decorative bento fill (inert, pointer-transparent). Both
// share identical geometry, so the board positions and windows them through
// this one shape; there is no separate placeholder
// render path. Placeholders genuinely have no component/label and live on
// world-absolute coords, so they stay out of the registry; the two sources
// merge HERE into the single list everything downstream consumes.
type BoardCell = { id: string; rect: Rect; entry?: TileRegistryEntry };

// First-render seed before the mount useLayoutEffect positions the fixed view.
const INITIAL_VIEW = { left: 0, top: 0, vw: BOARD_W, vh: BOARD_H };

// Fixed banner (same visual language as ConnectionLostBanner) shown when the
// resolved layout couldn't place every tile ,
// e.g. a newly-registered tile with no free space. In practice this is
// unreachable: the codegen validator rejects overlapping rects, so `unplaced`
// is always empty. Kept as a defensive fallback with neutral copy (no
// instruction to a layout editor, which no longer exists post-Slice-1).
function UnplacedTilesBanner({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <NotificationBanner tone="amber">A tile could not be placed on the board</NotificationBanner>
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

/**
 * The fixed panel board. Tiles retain world-cell coordinates, but the viewport
 * is positioned once around their bounds and never pans. Zoom is fixed at 1:1.
 *
 * Layout comes straight from the tile registry (resolveLayout over registry
 * coordinates, collisions resolved by scanline). Tile bounds must fit the
 * fixed panel viewport.
 */
export function Board() {
  const stageRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<BoardView>(INITIAL_VIEW);

  // Idle dimming is native-only: off-device (a browser) there is no backlight
  // to drop, so the whole feature is a no-op rather than a CSS scrim.
  const nativeDisplay = isNativeDisplay();

  // The panel session's current phase. "ended" = the idle timeout elapsed:
  // the panel is dimmed and relocked. Drives the DimOverlay wake shield
  // and the backlight below.
  const sessionPhase = panelSession.usePhase();

  // Tile placement, computed once from the registry defaults (positions come
  // straight from TILE_REGISTRY coords, collisions resolved by the scanline in
  // resolveLayout). Static and constant — there is no server layout to poll.
  const layout = useMemo(() => resolveLayout(), []);

  // The single source of truth for every cell this render. Placeholders come
  // FIRST so they paint BENEATH the real tiles (DOM order = paint order); real
  // tiles overlay. The tile set is constant, so this memoizes once.
  const boardCells: BoardCell[] = useMemo(() => {
    const bento = bentoFor(
      layout.tiles.map((t) => ({ col: t.worldCol, row: t.worldRow, cols: t.cols, rows: t.rows })),
    );
    return [
      ...bento.map((b) => ({ id: b.id, rect: worldCellRect(b.col, b.row, b.cols, b.rows) })),
      ...layout.tiles.map((entry) => ({ id: entry.id, rect: tileWorldRect(entry), entry })),
    ];
  }, [layout.tiles]);

  // A tile's own portalled modal can replay clicks up the React tree; avoid
  // opening the tile detail behind it.
  const anyModalOpen = useAnyModalOpen();
  const modalOpen = anyModalOpen;

  // Center the whole tile arrangement in the real stage before first paint.
  // Layout is static, so this is the board's one fixed camera position.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const rects = layout.tiles.map(tileWorldRect);
    const left = Math.min(...rects.map((r) => r.x));
    const right = Math.max(...rects.map((r) => r.x + r.w));
    const top = Math.min(...rects.map((r) => r.y));
    const bottom = Math.max(...rects.map((r) => r.y + r.h));
    setView({
      left: (left + right - stage.clientWidth) / 2,
      top: (top + bottom - stage.clientHeight) / 2,
      vw: stage.clientWidth,
      vh: stage.clientHeight,
    });
  }, [layout.tiles]);

  // ── panel session ────────────────────────────────────────────────────────────
  // ONE activity clock (lib/panel-session) replaces the old idle-reset + idle-dim
  // timers. Touch is the only activity source; on the idle timeout a single
  // SESSION END fires (dim → strip overlays → relock). Native only:
  // the dim drops the real iPad backlight, so off-device the whole session is
  // inert (no scrim, no auto-lock) , matching the old idle-dim gate.
  // NB the PIN relock rides this same gate: idle-dim off (or off-device) means an
  // unlock never expires. Accepted (I-2/ADR-0004) — the client PIN is a courtesy
  // gate; Slice S's server-side session.unlock(pin) is the real enforcement.
  const sessionEnabled = nativeDisplay;

  // Feed the clock: the idle-dim timeout is THE session timeout. Stop the clock
  // on unmount so a torn-down Board never ends a session.
  useEffect(() => {
    panelSession.setTimeoutMs(IDLE_DIM_TIMEOUT_MS);
  }, []);
  useEffect(() => {
    setSessionEnabled(sessionEnabled);
    return () => setSessionEnabled(false);
  }, [sessionEnabled]);

  // The session-end fan-out dims and strips overlays, registered once.
  useEffect(
    () =>
      registerSessionEffects({
        dim: () => {
          if (nativeDisplay) void dimTo(IDLE_DIM_LEVEL);
        },
        closeTileDetail: () => closeTileDetail(),
        clearModals: () => dismissAllModals(),
      }),
    [nativeDisplay],
  );

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
    if (sessionPhase === "active") void wakeTo(ACTIVE_BRIGHTNESS);
  }, [sessionPhase, nativeDisplay]);
  // Never leave the backlight dimmed if the board unmounts mid-session.
  useEffect(() => () => void wakeTo(ACTIVE_BRIGHTNESS), []);

  const wake = useCallback(() => {
    // The tap that ends a dim is the "someone approached the panel" signal, so
    // kick off the front-camera wake burst (fire-and-forget, best-effort , see
    // lib/wake-capture). Mint a fresh interaction-session id per wake so the
    // uploaded frames carry x-session-id: wake_photo.interaction_session_id
    // is how the Activity tile's Sessions view groups a visit's photos
    // (features/wakes/service.ts's listInteractionSessions filters on it being
    // non-null). 16 hex chars comfortably satisfies the server's
    // ^isn_[0-9a-z]{1,32}$ validation (features/wakes/http.ts).
    if (nativeDisplay) captureWakeBurst(genId("isn", { length: 16 }));
    // touch() wakes the session (ended → active) and rearms the clock; the
    // backlight effect above brightens off the phase flip.
    panelSession.touch();
  }, [nativeDisplay]);

  // Open a tile's detail on a plain tap or keyboard activation. Face-only
  // tiles have no Tile View and keep their own interactions.
  const activateTile = useCallback((entry: TileRegistryEntry) => {
    if (!getTileDetailEntry(entry.id)) return;
    openTileDetail(entry.id);
  }, []);

  // Inner controls own their taps; plain tile taps open the detail page.
  function onTileClickCapture(entry: TileRegistryEntry, e: React.MouseEvent<HTMLDivElement>) {
    // Portalled modal clicks can replay through this wrapper.
    if (modalOpen) return;
    // A tile's whole face opens its detail page; inner controls own their taps
    // via INTERACTIVE_SELECTOR.
    const controlTap = Boolean((e.target as HTMLElement).closest(INTERACTIVE_SELECTOR));
    if (controlTap) return;
    activateTile(entry);
  }

  // One windowed list for the whole board: real tiles and placeholders alike.
  const visibleCells = getVisibleTiles(boardCells, view);

  return (
    <div
      id="stage"
      ref={stageRef}
      style={{
        position: "fixed",
        inset: 0,
        overflow: "clip",
        background: "var(--bg)",
        touchAction: "none",
        overscrollBehavior: "none",
      }}
    >
      <div
        id="world"
        className="e-root"
        style={{
          position: "relative",
          left: -view.left,
          top: -view.top,
          width: WORLD_W,
          height: WORLD_H,
          backgroundColor: "var(--bg)",
        }}
      >
        {/* ONE render path for every cell. Geometry (position, size) is shared;
            a cell with an `entry`
            renders an interactive tile, one without renders inert bento fill.
            Placeholders sort first in boardCells so they paint underneath. */}
        {visibleCells.map(({ id, rect, entry }) => {
          const geometry: React.CSSProperties = {
            position: "absolute",
            left: rect.x,
            top: rect.y,
            width: rect.w,
            height: rect.h,
          };
          // Decorative bento fill: pointer-transparent so it never intercepts
          // taps, no component, no interaction.
          if (!entry) {
            return (
              <div key={id} style={{ ...geometry, pointerEvents: "none" }}>
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
                {entry.access.requiresFreshUnlock ? (
                  <div
                    data-testid={`private-tile-${entry.id}`}
                    style={{
                      height: "100%",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 10,
                      background: "var(--tile)",
                      color: "var(--ink-2)",
                      fontFamily: "var(--ui)",
                    }}
                  >
                    <Icon name="lock" s={24} />
                    <span>{entry.label}</span>
                  </div>
                ) : (
                  <TileComponent />
                )}
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
          <UpdateReloadBanner />
          <UnplacedTilesBanner count={layout.unplaced.length} />
        </NotificationBannerStack>
        <SettingsButton />
      </div>
      {/* Idle dim tap-shield (native only). Sits above the board + its chrome but
          below modals (which portal to <body>) so it swallows the wake tap. */}
      <DimOverlay active={sessionPhase === "ended"} onWake={wake} />
      {/* Full-page detail path (store-driven). Registers with modal-open-store,
          so the existing modalOpen freeze/bail logic covers it automatically. */}
      <TileDetailHost />
    </div>
  );
}
