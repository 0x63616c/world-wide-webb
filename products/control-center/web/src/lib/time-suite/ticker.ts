/**
 * The time suite's single shared tick source.
 *
 * One 250 ms interval, running iff at least one store holds a handle , the
 * timer store holds one while a timer is running or a done-timer nag is live,
 * the alarm store whenever an enabled alarm exists or one is firing. An idle
 * panel (no timers, no enabled alarms) runs NO interval at all.
 *
 * 250 ms (not 1 s) so a deadline crossing is noticed well inside the same
 * second it lands in; the stores derive everything from absolute wall-clock
 * deadlines, so tick cadence only bounds cue latency, never accuracy.
 */

const TICK_MS = 250;

interface TickHandle {
  fn: (nowMs: number) => void;
}

const handles = new Set<TickHandle>();
let interval: ReturnType<typeof setInterval> | null = null;

/**
 * Register a tick callback. The shared interval starts with the first handle
 * and stops with the last release. Returns an idempotent release.
 */
export function startTicks(fn: (nowMs: number) => void): () => void {
  const handle: TickHandle = { fn };
  handles.add(handle);
  if (interval === null) {
    interval = setInterval(() => {
      const now = Date.now();
      // Snapshot: a tick callback may release its own (or another) handle.
      for (const h of [...handles]) h.fn(now);
    }, TICK_MS);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    handles.delete(handle);
    if (handles.size === 0 && interval !== null) {
      clearInterval(interval);
      interval = null;
    }
  };
}
