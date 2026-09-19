/**
 * board-camera , the single seam that owns the panel board's camera: where the
 * viewport is pointed and how it gets there. One board on the wall, so one
 * module-level singleton (`boardCamera`), bound to the live #stage via
 * `attachCamera`.
 *
 * Two moves, both the browser's own smooth scroll:
 *  - `panTo`      , a user-driven recenter (a tile tap, a keyboard activation).
 *  - `glideHome`  , the app-driven idle return to the home tile.
 *
 * There is no JS spring and no scroll-snap. The board used to A/B five settle
 * modes against a hand-rolled SmoothDamp; pointer pan plus these two glides is
 * what survived, and native smooth scroll does both without a frame loop to
 * fight the compositor.
 */

type TileId = string;

// ─── host ─────────────────────────────────────────────────────────────────────

/**
 * The Board-supplied bindings the camera reads at move time. Passed to
 * `attachCamera`; every accessor is called lazily so the camera always sees the
 * live home position / layout, without re-attaching each render.
 */
export interface BoardCameraHost {
  /** The live scroll container the camera drives. */
  stage: HTMLDivElement;
  /** World-pixel center of the home tile (the idle glide-home target). */
  home(): { cx: number; cy: number };
  /** World-pixel center of a tile by id, or undefined if not placed. */
  tileCenter(id: TileId): { cx: number; cy: number } | undefined;
}

/** The public camera face other modules (e.g. panel-session) consume. */
export interface BoardCamera {
  /** Glide-center on a tile (by id) or a world point. */
  panTo(target: TileId | { x: number; y: number }): void;
  /** The idle glide-home animation, callable on demand. App-driven. */
  glideHome(): void;
}

interface BoardCameraInternal extends BoardCamera {
  attach(host: BoardCameraHost): () => void;
}

/**
 * Center the viewport on a world point via the browser's native smooth scroll.
 * `scrollTo` is absent in some test/SSR envs , fall back to a direct set.
 */
function scrollToCenter(stage: HTMLDivElement, worldX: number, worldY: number): void {
  const left = worldX - stage.clientWidth / 2;
  const top = worldY - stage.clientHeight / 2;
  if (typeof stage.scrollTo === "function") {
    stage.scrollTo({ left, top, behavior: "smooth" });
    return;
  }
  stage.scrollLeft = left;
  stage.scrollTop = top;
}

function createBoardCamera(): BoardCameraInternal {
  let host: BoardCameraHost | null = null;

  const panTo = (target: TileId | { x: number; y: number }) => {
    if (!host) return;
    const center =
      typeof target === "string" ? host.tileCenter(target) : { cx: target.x, cy: target.y };
    if (!center) return;
    scrollToCenter(host.stage, center.cx, center.cy);
  };

  const glideHome = () => {
    if (!host) return;
    const { cx, cy } = host.home();
    scrollToCenter(host.stage, cx, cy);
  };

  const attach = (next: BoardCameraHost) => {
    host = next;
    return () => {
      // Only tear down if still bound to this host (guards a stale cleanup after
      // a re-attach to a new stage).
      if (host === next) host = null;
    };
  };

  return { panTo, glideHome, attach };
}

const camera = createBoardCamera();

/** The board camera singleton , public face. */
export const boardCamera: BoardCamera = camera;

// Board-internal wiring (Board.tsx only). Kept off the public `BoardCamera`
// type so external consumers see just the two-method contract.
export const attachCamera = camera.attach;
