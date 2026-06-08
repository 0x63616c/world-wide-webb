/**
 * Types for the Spotify Web API client (CC-51hf.33).
 */

/** Constructor credentials for SpotifyClient. */
export interface SpotifyCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

/** Spotify track playing state. */
export interface SpotifyNowPlaying {
  isPlaying: boolean;
  trackTitle: string;
  artist: string;
  album: string;
  albumArtUrl: string | null;
  progressMs: number;
  durationMs: number;
  deviceName: string | null;
}
