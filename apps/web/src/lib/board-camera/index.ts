/**
 * board-camera , the single seam that owns the panel board's camera: where the
 * viewport is pointed and how it animates there. One board on the wall, so one
 * module-level singleton (`boardCamera`), bound to the live #stage via
 * `attachCamera`. The physics (SmoothDamp spring) live in camera.ts and the
 * move dispatch in glide.ts; this file composes them behind a small imperative
 * surface and an observable `isSettling` store.
 *
 * `Board.tsx` and the useBoard hooks delegate every camera move here; an
 * upcoming panel-session module drives `glideHome()` / reads `isSettling()`
 * through the public `BoardCamera` face. The host callbacks (snap mode, home
 * position, tile/cell resolution, user-vs-programmatic marking) come from Board
 * via `attachCamera`, so this module stays free of layout + React concerns.
 */

import type { SnapMode } from "../settings";
import { createStore, type Store } from "../store";
import { createSpring, type Rect, SNAP_DEADZONE, type Spring } from "./camera";
import { glideTo, jumpTo as nativeJumpTo } from "./glide";

type TileId = string;

// ─── snap-mode CSS (moved verbatim from Board.tsx) ────────────────────────────
// We're A/B-testing how the board should settle. Three of these are NATIVE CSS
// scroll-snap (browser does the momentum + snapping on the compositor thread ,
// no JS spring to fight, so no Mac-trackpad jitter); "spring" is the legacy
// hand-rolled SmoothDamp magnetic snap, kept only so it can be compared head to
// head on-device. The mode vocabulary + persistence live in lib/settings.
//
// CSS scroll-snap-type per mode; "spring" disables native snap (JS drives it).
// "mandatory-settle" keeps native mandatory paging but ALSO runs the JS settle
// (see settle) as a safety net: iOS Safari only re-snaps after a momentum
// animation, so a zero-velocity finger lift leaves the page off-center , the
// settle springs it home. A flick still snaps natively (settle is a no-op then).
export const SNAP_CSS: Record<SnapMode, string> = {
  proximity: "both proximity",
  mandatory: "both mandatory",
  "mandatory-settle": "both mandatory",
  none: "none",
  spring: "none",
};

// Modes whose settle (scrollend / idle) magnetically re-centers via the JS spring.
const SETTLE_MODES = new Set<SnapMode>(["spring", "mandatory-settle"]);

// ─── host ─────────────────────────────────────────────────────────────────────

/**
 * The Board-supplied bindings the camera reads at move time. Passed to
 * `attachCamera`; every accessor is called lazily so the camera always sees the
 * live snap mode / home position / layout, without re-attaching each render.
 */
export interface BoardCameraHost {
  /** The live scroll container the camera drives. */
  stage: HTMLDivElement;
  /** Current snap mode (settings-driven). */
  snapMode(): SnapMode;
  /** World-pixel center of the home tile (the idle glide-home target). */
  home(): { cx: number; cy: number };
  /** World-pixel center of a tile by id, or undefined if not placed. */
  tileCenter(id: TileId): { cx: number; cy: number } | undefined;
  /** Cell under a world point, for the magnetic settle re-center. */
  cellAt(worldX: number, worldY: number): { rect: Rect } | undefined;
  /** True while a pointer/drag is active , suppresses the magnetic settle. */
  interacting(): boolean;
  /** Mark the coming scroll frames as user-driven (shows pan chrome). */
  markUser(): void;
  /** Mark the coming scroll frames as app-driven (hides pan chrome). */
  markProgrammatic(): void;
}

// ─── public + internal surfaces ───────────────────────────────────────────────

/** The public camera face other modules (e.g. panel-session) consume. */
export interface BoardCamera {
  /** Glide-center on a tile (by id) or a world point. A user-driven recenter. */
  panTo(target: TileId | { x: number; y: number }): void;
  /** The idle glide-home animation, callable on demand. App-driven. */
  glideHome(): void;
  /** Suspend the JS physics (layout-edit mode). Cancels any running spring. */
  freeze(): void;
  /** Resume the JS physics. */
  unfreeze(): void;
  /** True while a snap/glide spring animation is in flight. */
  isSettling(): boolean;
  /** Observe `isSettling` transitions. */
  subscribe(listener: () => void): () => void;
}

/**
 * The wider surface Board + the useBoard hooks wire against , the public
 * `boardCamera` export is narrowed to `BoardCamera`, these extras are exported
 * as standalone functions below.
 */
interface BoardCameraInternal extends BoardCamera {
  attach(host: BoardCameraHost): () => void;
  cancel(): void;
  settle(): void;
  jumpTo(worldX: number, worldY: number, smooth: boolean): void;
}

function createBoardCamera(): BoardCameraInternal {
  const store: Store<{ settling: boolean }> = createStore<{ settling: boolean }>({
    settling: false,
  });
  const spring = createSpring((running) => store.set({ settling: running }));
  let host: BoardCameraHost | null = null;
  let frozen = false;

  const springTo = (toLeft: number, toTop: number) => {
    if (frozen || !host) return;
    spring.to(host.stage, toLeft, toTop);
  };

  // A Spring facade routed through `springTo` so the frozen-gate applies to the
  // spring-mode glide path too (glideTo drives the spring directly).
  const guardedSpring: Spring = {
    to: (_stage, toLeft, toTop) => springTo(toLeft, toTop),
    cancel: () => spring.cancel(),
    running: () => spring.running(),
  };

  const settle = () => {
    // JS spring and mandatory-settle magnetically re-center; pure native
    // scroll-snap modes let the browser handle it (no JS = no trackpad fight).
    if (!host) return;
    if (!SETTLE_MODES.has(host.snapMode())) return;
    if (spring.running() || host.interacting()) return;
    const { stage } = host;
    const cx = stage.scrollLeft + stage.clientWidth / 2;
    const cy = stage.scrollTop + stage.clientHeight / 2;
    const hit = host.cellAt(cx, cy);
    if (!hit) return;
    const toLeft = hit.rect.x + hit.rect.w / 2 - stage.clientWidth / 2;
    const toTop = hit.rect.y + hit.rect.h / 2 - stage.clientHeight / 2;
    if (Math.hypot(toLeft - stage.scrollLeft, toTop - stage.scrollTop) < SNAP_DEADZONE) return;
    springTo(toLeft, toTop);
  };

  const jumpTo = (worldX: number, worldY: number, smooth: boolean) => {
    if (!host) return;
    nativeJumpTo(host.stage, worldX, worldY, smooth);
  };

  const panTo = (target: TileId | { x: number; y: number }) => {
    if (!host) return;
    const center =
      typeof target === "string" ? host.tileCenter(target) : { cx: target.x, cy: target.y };
    if (!center) return;
    // A tap/keyboard recenter is the user moving the board.
    host.markUser();
    glideTo(host.stage, host.snapMode(), guardedSpring, center.cx, center.cy);
  };

  const glideHome = () => {
    if (!host) return;
    host.markProgrammatic();
    const { cx, cy } = host.home();
    jumpTo(cx, cy, true);
  };

  const attach = (next: BoardCameraHost) => {
    host = next;
    return () => {
      // Only tear down if still bound to this host (guards a stale cleanup after
      // a re-attach to a new stage).
      if (host === next) {
        spring.cancel();
        host = null;
      }
    };
  };

  return {
    panTo,
    glideHome,
    freeze: () => {
      frozen = true;
      spring.cancel();
    },
    unfreeze: () => {
      frozen = false;
    },
    isSettling: () => store.get().settling,
    subscribe: store.subscribe,
    attach,
    cancel: () => spring.cancel(),
    settle,
    jumpTo,
  };
}

const camera = createBoardCamera();

/** The board camera singleton , public face. */
export const boardCamera: BoardCamera = camera;

// Board-internal wiring (Board.tsx + useBoard hooks only). Kept off the public
// `BoardCamera` type so external consumers see just the six-method contract.
export const attachCamera = camera.attach;
export const cameraCancel = camera.cancel;
export const cameraSettle = camera.settle;
export const cameraJumpTo = camera.jumpTo;
