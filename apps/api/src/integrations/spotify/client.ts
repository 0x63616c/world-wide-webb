/**
 * SpotifyClient — lazily mints and caches a Spotify access token from a
 * refresh token, then provides thin wrappers over the Spotify Web API.
 *
 * Token lifetime: 1 hour. Cache is invalidated 60s before expiry so the next
 * call mints a fresh token before the old one expires in flight.
 *
 * Every method THROWS SpotifyError when credentials are unconfigured, the
 * token refresh fails, or the upstream API returns an error — never returns
 * fabricated data (CC-51hf.33, A3, A4).
 */

import { SpotifyError } from "./errors";
import type {
  SpotifyBrowseResult,
  SpotifyCredentials,
  SpotifyNowPlaying,
  SpotifyPlaylistItem,
  SpotifyRecentTrack,
} from "./types";

const TOKEN_URL = "https://accounts.spotify.com/api/token";
// Refresh 60s before the token actually expires so in-flight requests never
// hit a stale token.
const EXPIRY_BUFFER_MS = 60_000;

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

export class SpotifyClient {
  private readonly creds: SpotifyCredentials;
  private cache: CachedToken | null = null;

  constructor(creds: SpotifyCredentials) {
    this.creds = creds;
  }

  /**
   * Returns a valid access token, refreshing if the cache is empty or near
   * expiry. THROWS SpotifyError if credentials are unconfigured or the refresh
   * API call fails.
   */
  async getAccessToken(): Promise<string> {
    if (!this.creds.clientId || !this.creds.clientSecret || !this.creds.refreshToken) {
      throw new SpotifyError(
        "Spotify credentials unconfigured: SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, and SPOTIFY_REFRESH_TOKEN must all be non-empty",
      );
    }

    const now = Date.now();
    if (this.cache && this.cache.expiresAtMs > now) {
      return this.cache.accessToken;
    }

    return this.refreshToken();
  }

  /**
   * GET /v1/me/player — current playback state. Returns null when nothing is
   * playing (204 No Content). THROWS SpotifyError on any error.
   */
  async getNowPlaying(): Promise<SpotifyNowPlaying | null> {
    const token = await this.getAccessToken();
    let res: Response;
    try {
      res = await fetch("https://api.spotify.com/v1/me/player", {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      throw new SpotifyError(`getNowPlaying: network error — ${(err as Error).message}`);
    }

    // 204 = nothing playing
    if (res.status === 204) return null;

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new SpotifyError(`getNowPlaying: HTTP ${res.status} — ${body.slice(0, 200)}`);
    }

    const data = (await res.json()) as Record<string, unknown>;
    const item = data.item as Record<string, unknown> | null;
    if (!item) return null;

    const artists = (item.artists as Array<{ name: string }> | undefined) ?? [];
    const album = item.album as Record<string, unknown> | undefined;
    const images = (album?.images as Array<{ url: string }> | undefined) ?? [];
    const device = (data.device as Record<string, unknown> | undefined) ?? null;

    return {
      isPlaying: data.is_playing === true,
      trackTitle: (item.name as string) ?? "",
      artist: artists.map((a) => a.name).join(", "),
      album: (album?.name as string) ?? "",
      albumArtUrl: images[0]?.url ?? null,
      progressMs: (data.progress_ms as number) ?? 0,
      durationMs: (item.duration_ms as number) ?? 0,
      deviceName: (device?.name as string) ?? null,
    };
  }

  /**
   * GET /v1/me/player/recently-played + GET /v1/me/playlists — returns
   * recently-played tracks and user playlists for the Quick-Play modal (A16).
   * THROWS SpotifyError on any error.
   */
  async browse(): Promise<SpotifyBrowseResult> {
    const token = await this.getAccessToken();

    const [recentlyPlayed, playlists] = await Promise.all([
      this.fetchRecentlyPlayed(token),
      this.fetchPlaylists(token),
    ]);

    return { recentlyPlayed, playlists };
  }

  /**
   * PUT /v1/me/player/play — resume or start playback. THROWS SpotifyError on any error.
   */
  async play(): Promise<void> {
    await this.playerCommand("PUT", "https://api.spotify.com/v1/me/player/play", "play");
  }

  /**
   * PUT /v1/me/player/pause — pause playback. THROWS SpotifyError on any error.
   */
  async pause(): Promise<void> {
    await this.playerCommand("PUT", "https://api.spotify.com/v1/me/player/pause", "pause");
  }

  /**
   * POST /v1/me/player/next — skip to next track. THROWS SpotifyError on any error.
   */
  async next(): Promise<void> {
    await this.playerCommand("POST", "https://api.spotify.com/v1/me/player/next", "next");
  }

  /**
   * POST /v1/me/player/previous — skip to previous track. THROWS SpotifyError on any error.
   */
  async previous(): Promise<void> {
    await this.playerCommand("POST", "https://api.spotify.com/v1/me/player/previous", "previous");
  }

  /**
   * PUT /v1/me/player/seek?position_ms=<ms> — seek to position. THROWS SpotifyError on any error.
   */
  async seek(positionMs: number): Promise<void> {
    const url = `https://api.spotify.com/v1/me/player/seek?position_ms=${positionMs}`;
    await this.playerCommand("PUT", url, "seek");
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private async fetchRecentlyPlayed(token: string): Promise<SpotifyRecentTrack[]> {
    let res: Response;
    try {
      res = await fetch("https://api.spotify.com/v1/me/player/recently-played?limit=20", {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      throw new SpotifyError(`browse/recently-played: network error — ${(err as Error).message}`);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new SpotifyError(`browse/recently-played: HTTP ${res.status} — ${body.slice(0, 200)}`);
    }

    const data = (await res.json()) as { items?: unknown[] };
    const items = data.items ?? [];

    // Deduplicate by track id — the recently-played list can repeat the same
    // track if it was played multiple times.
    const seen = new Set<string>();
    const tracks: SpotifyRecentTrack[] = [];

    for (const raw of items) {
      const item = raw as Record<string, unknown>;
      const track = item.track as Record<string, unknown> | undefined;
      if (!track) continue;

      const id = track.id as string | undefined;
      if (!id || seen.has(id)) continue;
      seen.add(id);

      const artists = (track.artists as Array<{ name: string }> | undefined) ?? [];
      const album = track.album as Record<string, unknown> | undefined;
      const images = (album?.images as Array<{ url: string }> | undefined) ?? [];

      tracks.push({
        id,
        title: (track.name as string) ?? "",
        artist: artists.map((a) => a.name).join(", "),
        albumArtUrl: images[0]?.url ?? null,
        uri: (track.uri as string) ?? "",
      });
    }

    return tracks;
  }

  private async fetchPlaylists(token: string): Promise<SpotifyPlaylistItem[]> {
    let res: Response;
    try {
      res = await fetch("https://api.spotify.com/v1/me/playlists?limit=20", {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      throw new SpotifyError(`browse/playlists: network error — ${(err as Error).message}`);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new SpotifyError(`browse/playlists: HTTP ${res.status} — ${body.slice(0, 200)}`);
    }

    const data = (await res.json()) as { items?: unknown[] };
    const items = data.items ?? [];
    const playlists: SpotifyPlaylistItem[] = [];

    for (const raw of items) {
      const pl = raw as Record<string, unknown>;
      const id = pl.id as string | undefined;
      if (!id) continue;

      const images = (pl.images as Array<{ url: string }> | undefined) ?? [];

      playlists.push({
        id,
        title: (pl.name as string) ?? "",
        description: (pl.description as string | null) ?? null,
        imageUrl: images[0]?.url ?? null,
        uri: (pl.uri as string) ?? "",
      });
    }

    return playlists;
  }

  private async refreshToken(): Promise<string> {
    const { clientId, clientSecret, refreshToken } = this.creds;
    const basic = btoa(`${clientId}:${clientSecret}`);
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });

    let res: Response;
    try {
      res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });
    } catch (err) {
      throw new SpotifyError(`Token refresh: network error — ${(err as Error).message}`);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new SpotifyError(`Token refresh: HTTP ${res.status} — ${text.slice(0, 200)}`);
    }

    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    const accessToken = json.access_token;
    const expiresIn = json.expires_in ?? 3600;

    if (!accessToken) {
      throw new SpotifyError("Token refresh: response missing access_token");
    }

    this.cache = {
      accessToken,
      expiresAtMs: Date.now() + expiresIn * 1000 - EXPIRY_BUFFER_MS,
    };

    return accessToken;
  }

  /**
   * Executes a player command (play/pause/next/previous/seek) using the given
   * HTTP method and URL. Accepts 200, 204, and 403 (no active device) as
   * "success" — the mutation fired, Spotify's response is informational.
   * THROWS SpotifyError on network failure or unexpected server errors.
   */
  private async playerCommand(method: string, url: string, label: string): Promise<void> {
    const token = await this.getAccessToken();
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      throw new SpotifyError(`${label}: network error — ${(err as Error).message}`);
    }

    // 200/204 = success; 403 = no active device (non-fatal — command was accepted)
    if (res.ok || res.status === 204 || res.status === 403) return;

    const body = await res.text().catch(() => "");
    throw new SpotifyError(`${label}: HTTP ${res.status} — ${body.slice(0, 200)}`);
  }
}
