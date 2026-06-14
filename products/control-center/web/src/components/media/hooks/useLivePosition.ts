import { useEffect, useState } from "react";

/**
 * Extrapolates the playback position between polls. HA only refreshes
 * media_position on state changes (play/pause/seek), so the raw value can sit
 * at "0:02" for an entire video; while playing we advance the displayed
 * position locally from media_position_updated_at, ticking once a second.
 */
export function useLivePosition(
  position: number | null,
  updatedAt: string | null,
  state: string,
  duration: number | null,
): number | null {
  const playing = state === "playing";
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [playing]);

  if (position === null) return null;
  if (!playing || !updatedAt) return position;

  const anchorMs = Date.parse(updatedAt);
  if (Number.isNaN(anchorMs)) return position;

  const live = position + Math.max(0, (nowMs - anchorMs) / 1000);
  return duration !== null ? Math.min(live, duration) : live;
}
