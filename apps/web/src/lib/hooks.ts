import { useEffect, useState } from "react";

/**
 * A ticking clock. Re-renders every `intervalMs` (default 1s). Used by the
 * clock tile and any tile that needs a live "now".
 */
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Shared React Query polling interval constants (ms). Tiles pass these to
 * `refetchInterval` so refresh cadence stays consistent with the spec.
 */
export const POLL = {
  weather: 10 * 60 * 1000,
  network: 60 * 1000,
  tesla: 60 * 1000,
  controls: 30 * 1000,
  climate: 30 * 1000,
  events: 5 * 60 * 1000,
} as const;
