/**
 * Spotify service , thin wrappers over SpotifyClient that expose the
 * now-playing query, transport mutations, and browse query for the tRPC media
 * router.
 *
 * A singleton SpotifyClient is constructed from env credentials on first use
 * (lazy) so the api boots without Spotify configured , callers get a
 * SpotifyError on first call when credentials are absent (A3, A4).
 *
 * All functions THROW SpotifyError on unconfigured credentials or upstream
 * API errors , never return fabricated data (A3).
 */

import { env } from "../env";
import type { SpotifyBrowseResult } from "../integrations/spotify";
import { SpotifyClient } from "../integrations/spotify";

/** Spotify player state returned by the nowPlaying query (A14). */
export interface SpotifyPlayerState {
  /** True when the 204 (nothing playing) path was hit. */
  isIdle: boolean;
  isPlaying: boolean;
  trackTitle: string | null;
  artist: string | null;
  album: string | null;
  albumArtUrl: string | null;
  progressMs: number | null;
  durationMs: number | null;
  deviceName: string | null;
}

// Lazy singleton , constructed once on first service call. Re-created if
// credentials change (but they won't in a running container; restart handles that).
let _client: SpotifyClient | null = null;
function getClient(): SpotifyClient {
  if (!_client) {
    _client = new SpotifyClient({
      clientId: env.SPOTIFY_CLIENT_ID,
      clientSecret: env.SPOTIFY_CLIENT_SECRET,
      refreshToken: env.SPOTIFY_REFRESH_TOKEN,
    });
  }
  return _client;
}

/**
 * GET /v1/me/player , returns real Spotify player state (A14).
 * 204 (nothing playing) maps to an explicit idle state , never fabricated.
 * THROWS SpotifyError when unconfigured or the upstream call fails (A3).
 */
export async function spotifyNowPlaying(): Promise<SpotifyPlayerState> {
  const data = await getClient().getNowPlaying();

  if (data === null) {
    return {
      isIdle: true,
      isPlaying: false,
      trackTitle: null,
      artist: null,
      album: null,
      albumArtUrl: null,
      progressMs: null,
      durationMs: null,
      deviceName: null,
    };
  }

  return {
    isIdle: false,
    isPlaying: data.isPlaying,
    trackTitle: data.trackTitle,
    artist: data.artist,
    album: data.album,
    albumArtUrl: data.albumArtUrl,
    progressMs: data.progressMs,
    durationMs: data.durationMs,
    deviceName: data.deviceName,
  };
}

/**
 * GET /v1/me/player/recently-played + GET /v1/me/playlists , returns real
 * Spotify content for the Quick-Play Spotify modal (A16).
 * THROWS SpotifyError when unconfigured or the upstream call fails (A3).
 */
export async function spotifyBrowse(): Promise<SpotifyBrowseResult> {
  return getClient().browse();
}

/** PUT /v1/me/player/play , resume playback. THROWS SpotifyError on any failure (A3, A15). */
export async function spotifyPlay(): Promise<void> {
  await getClient().play();
}

/** PUT /v1/me/player/pause , pause playback. THROWS SpotifyError on any failure (A3, A15). */
export async function spotifyPause(): Promise<void> {
  await getClient().pause();
}

/** POST /v1/me/player/next , skip to next track. THROWS SpotifyError on any failure (A3, A15). */
export async function spotifyNext(): Promise<void> {
  await getClient().next();
}

/** POST /v1/me/player/previous , skip to previous. THROWS SpotifyError on any failure (A3, A15). */
export async function spotifyPrevious(): Promise<void> {
  await getClient().previous();
}

/** PUT /v1/me/player/seek , seek to positionMs. THROWS SpotifyError on any failure (A3, A15). */
export async function spotifySeek(positionMs: number): Promise<void> {
  await getClient().seek(positionMs);
}
