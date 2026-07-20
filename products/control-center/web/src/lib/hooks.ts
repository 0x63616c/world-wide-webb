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
  camera: 30 * 1000,
  dogcam: 30 * 1000,
  // Wall-panel settings are global + rarely changed; a 15s poll picks up an edit
  // made on another panel within one tick without hammering the API.
  settings: 15 * 1000,
  // Deploys tile: 10s keeps "deploying" within one worker hot tick of real,
  // while the worker's own idle gate (60s) bounds GitHub traffic , the tile
  // polling faster than the worker only ever re-reads Postgres.
  deploy: 10 * 1000,
  // Board layout (tile placement) is edited rarely but must propagate fast: the
  // editor is expected to be used while looking at the panel, so a 5s poll picks
  // up a save from another device (or the editor itself) with no visible lag.
  layout: 5 * 1000,
  // Apple TV playback state moves quickly during a session; 5s keeps the
  // now-playing strip's title/transport close to real.
  tvNowPlaying: 5 * 1000,
  // Installed-app list + current app change infrequently; 10s is plenty.
  tvApps: 10 * 1000,
  // Sonos topology + volumes change infrequently; 10s covers group/volume edits.
  soundSystem: 10 * 1000,
  // Favorites + Spotify browse content are near-static; 30s is a light refresh.
  quickPlay: 30 * 1000,
  // Wake photos land a few times a day; 60s is well inside a "since I looked" gap.
  wakePhotos: 60 * 1000,
  // Notifications are the one surface where lag is the failure: an alert the
  // panel shows a minute late is an alert nobody acted on. 5s matches the board
  // layout poll (the fastest cadence already in use) and the payload is small.
  notifications: 5 * 1000,
} as const;
