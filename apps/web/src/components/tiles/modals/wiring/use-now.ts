import { useEffect, useState } from "react";

/**
 * Ticking current time for modals that animate against the wall clock
 * (solar arcs, world clocks, countdowns). Updates every `intervalMs` (default
 * 1s). Pure-component modals take `nowMs`/`now` via props so this lives here,
 * in the live wiring, not inside the views.
 */
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
