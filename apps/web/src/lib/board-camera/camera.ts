/**
 * board-camera physics , the SmoothDamp integrator and the single-axis-pair
 * spring that drives every JS-driven camera move (settle-snap + spring-mode
 * glide). Extracted VERBATIM from the old useBoard.ts so the feel is byte-for-
 * byte identical; the module owns the velocity/position refs the hooks used to
 * hold. No React here , this is pure mechanics against a scroll container.
 */

export type Rect = { x: number; y: number; w: number; h: number };

// ─── snap constants (moved verbatim from useBoard.ts) ─────────────────────────

const SNAP_SMOOTH_TIME = 0.32;
export const SNAP_DEADZONE = 6;
const SNAP_STOP_PX = 0.5;
const SNAP_STOP_VEL = 6;
const SNAP_MAX_DT = 0.05;

// ─── SmoothDamp ───────────────────────────────────────────────────────────────

// One axis of SmoothDamp (Thomas Lowe, Game Programming Gems 4). Returns
// [nextPos, nextVel]. The polynomial exp approximation avoids Math.exp.
export function smoothDamp(
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

// ─── spring ───────────────────────────────────────────────────────────────────

/**
 * A critically-damped snap that drives a scroll container's scrollLeft/Top to a
 * target via SmoothDamp on each rAF frame. One spring per board (owned by the
 * board-camera singleton); it holds the live velocity/position between frames.
 */
export interface Spring {
  /** Kick off a snap from the stage's current scroll position to (toLeft, toTop). */
  to(stage: HTMLDivElement, toLeft: number, toTop: number): void;
  /** Abort any running snap. */
  cancel(): void;
  /** True while a snap is in flight. */
  running(): boolean;
}

/**
 * Build a spring. `onRunningChange` fires whenever the in-flight state flips
 * (false→true on kickoff, true→false on settle/cancel) so the singleton can
 * mirror it into an observable `isSettling` store.
 */
export function createSpring(onRunningChange: (running: boolean) => void): Spring {
  const s = { raf: 0, vx: 0, vy: 0, last: 0, px: 0, py: 0 };

  // Single writer for `s.raf` so the running→idle transition notifies exactly
  // once. Kicking off while already running stays "running" (no spurious flip).
  const setRaf = (raf: number) => {
    const was = s.raf !== 0;
    s.raf = raf;
    if (was !== (raf !== 0)) onRunningChange(raf !== 0);
  };

  const cancel = () => {
    if (s.raf) cancelAnimationFrame(s.raf);
    setRaf(0);
  };

  const to = (stage: HTMLDivElement, toLeft: number, toTop: number) => {
    if (s.raf) cancelAnimationFrame(s.raf);
    s.vx = 0;
    s.vy = 0;
    s.px = stage.scrollLeft;
    s.py = stage.scrollTop;
    s.last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(SNAP_MAX_DT, (now - s.last) / 1000);
      s.last = now;
      const [nl, vl] = smoothDamp(s.px, toLeft, s.vx, SNAP_SMOOTH_TIME, dt);
      const [nt, vt] = smoothDamp(s.py, toTop, s.vy, SNAP_SMOOTH_TIME, dt);
      s.px = nl;
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
        setRaf(0);
      } else {
        setRaf(requestAnimationFrame(step));
      }
    };
    setRaf(requestAnimationFrame(step));
  };

  return { to, cancel, running: () => s.raf !== 0 };
}
