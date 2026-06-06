import { useCallback, useEffect, useRef, useState } from "react";

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
  camera: 30 * 1000,
  dogcam: 30 * 1000,
} as const;

/**
 * Single shared cooldown constant used by tiles that pause polling after a
 * mutation to let the backend's desired-window settle before reconciling HA
 * state (e.g. ControlsTile, ClimateTile). One place to tune the window.
 */
export const COOLDOWN_MS = 5_000;

/**
 * Pause polling and schedule a single invalidate after a mutation completes.
 * Returns `startCooldown()` — call it on any mutation that should trigger the
 * window. The `invalidate` callback fires once when the cooldown expires.
 *
 * Keeps the ref-sync trick internally so the caller's refetchInterval callback
 * always sees the latest timestamp without a new closure.
 */
export function useCooldownInvalidate(
  invalidate: () => Promise<unknown>,
  ms = COOLDOWN_MS,
): { cooldownRef: React.RefObject<number>; startCooldown: () => void } {
  const [cooldownUntil, setCooldownUntil] = useState(0);
  // Stable ref so refetchInterval callbacks always see the latest value without
  // being recreated on every state change.
  const cooldownRef = useRef(cooldownUntil);
  cooldownRef.current = cooldownUntil;

  // invalidate is a stable tRPC utils method — it won't change identity between
  // renders and would cause spurious re-runs if included in deps.
  // biome-ignore lint/correctness/useExhaustiveDependencies: invalidate is a stable tRPC utils method
  useEffect(() => {
    if (cooldownUntil === 0) return;
    const remaining = cooldownUntil - Date.now();
    if (remaining <= 0) {
      void invalidate();
      return;
    }
    const timer = setTimeout(() => {
      void invalidate();
    }, remaining);
    return () => clearTimeout(timer);
  }, [cooldownUntil]);

  const startCooldown = useCallback(() => setCooldownUntil(Date.now() + ms), [ms]);

  return { cooldownRef, startCooldown };
}
