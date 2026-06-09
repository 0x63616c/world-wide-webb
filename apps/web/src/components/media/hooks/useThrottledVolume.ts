/**
 * useThrottledVolume — throttle network volume writes during fader drag (www-83z4).
 *
 * Keeps the LOCAL fader instant (useMixer.setRoomVolume is called per-move) but
 * collapses the HIGH-FREQUENCY network writes to at most 1 per ~200ms per
 * deviceIp, with a leading call (instant feedback) and a trailing call (final
 * value is always delivered so pointer-up is never lost).
 *
 * Deduplication: if the trailing value equals the last value already sent for
 * that deviceIp, the trailing write is skipped.
 *
 * Per-deviceIp keying: each speaker gets its own independent throttle so
 * dragging two faders simultaneously doesn't interfere.
 *
 * Timer cleanup on unmount prevents stale writes after the component tears down.
 *
 * Why hand-rolled (no lodash/etc): no new deps, and the per-IP keying + dedupe
 * logic is simpler to audit in ~50 lines than plumbing a generic throttle.
 */

import { useCallback, useEffect, useRef } from "react";

const THROTTLE_MS = 200;

interface IpState {
  /** Timer id for the pending trailing write. */
  timer: ReturnType<typeof setTimeout> | null;
  /** The value that was last SENT over the network for deduplication. */
  lastSent: number | null;
  /** The most recent value requested (becomes the trailing write). */
  pending: number | null;
}

/**
 * Returns a stable `write(deviceIp, volume)` callback that throttles calls to
 * the provided `onWrite` function: leading edge fires immediately; a trailing
 * edge fires 200ms after the last call with the final value (deduped).
 */
export function useThrottledVolume(
  onWrite: (deviceIp: string, volume: number) => void,
): (deviceIp: string, volume: number) => void {
  // Per-IP state — a ref so updates never trigger re-renders.
  const state = useRef<Record<string, IpState>>({});

  // Clean up ALL pending timers on unmount so no stale writes fire.
  useEffect(() => {
    const current = state.current;
    return () => {
      for (const ip of Object.keys(current)) {
        const s = current[ip];
        if (s?.timer !== null && s.timer !== undefined) {
          clearTimeout(s.timer);
        }
      }
    };
  }, []);

  const write = useCallback(
    (deviceIp: string, volume: number) => {
      if (!state.current[deviceIp]) {
        state.current[deviceIp] = { timer: null, lastSent: null, pending: null };
      }
      const s = state.current[deviceIp];

      // Always record the most recent value as the candidate for trailing write.
      s.pending = volume;

      if (s.timer === null) {
        // No timer in flight — leading edge: fire immediately if not a duplicate.
        if (s.lastSent !== volume) {
          onWrite(deviceIp, volume);
          s.lastSent = volume;
        }

        // Arm the trailing timer.
        s.timer = setTimeout(() => {
          s.timer = null;
          // Trailing write: send pending value if it differs from what was last sent.
          if (s.pending !== null && s.pending !== s.lastSent) {
            onWrite(deviceIp, s.pending);
            s.lastSent = s.pending;
          }
          s.pending = null;
        }, THROTTLE_MS);
      }
      // If a timer is already in flight, pending is updated above and the trailing
      // write will send the latest value when the timer fires.
    },
    [onWrite],
  );

  return write;
}
