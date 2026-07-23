/**
 * Unit tests for the Spotify browse service (www-51hf.13).
 * Verifies A16: spotifyBrowse returns real recently-played + playlists content
 *   via the Spotify Web API, with mocked SpotifyClient.
 * Verifies A3: THROW on unconfigured or upstream error , no fake data.
 * All SpotifyClient calls are mocked , tests never reach the Spotify API.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// ── mock SpotifyClient ──────────────────────────────────────────────────────

const { mockGetNowPlaying, mockPlay, mockPause, mockNext, mockPrevious, mockSeek, mockBrowse } =
  vi.hoisted(() => ({
    mockGetNowPlaying: vi.fn(),
    mockPlay: vi.fn(),
    mockPause: vi.fn(),
    mockNext: vi.fn(),
    mockPrevious: vi.fn(),
    mockSeek: vi.fn(),
    mockBrowse: vi.fn(),
  }));

vi.mock("@www/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@www/core")>()),
  SpotifyClient: vi.fn().mockImplementation(() => ({
    getNowPlaying: mockGetNowPlaying,
    play: mockPlay,
    pause: mockPause,
    next: mockNext,
    previous: mockPrevious,
    seek: mockSeek,
    browse: mockBrowse,
  })),
  SpotifyError: class SpotifyError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "SpotifyError";
    }
  },
}));

// ── import after mock ───────────────────────────────────────────────────────

import { spotifyBrowse } from "../services/spotify-service";

// ── helpers ─────────────────────────────────────────────────────────────────

function makeRecentTrack(overrides: Record<string, unknown> = {}) {
  return {
    id: "track_abc",
    title: "Recently Played Track",
    artist: "Some Artist",
    albumArtUrl: "https://i.scdn.co/image/recent",
    uri: "spotify:track:abc123",
    ...overrides,
  };
}

function makePlaylist(overrides: Record<string, unknown> = {}) {
  return {
    id: "playlist_xyz",
    title: "Made For You Playlist",
    description: "Your daily mix",
    imageUrl: "https://i.scdn.co/image/playlist",
    uri: "spotify:playlist:xyz789",
    ...overrides,
  };
}

function makeBrowseResult(
  overrides: Partial<{ recentlyPlayed: unknown[]; playlists: unknown[] }> = {},
) {
  return {
    recentlyPlayed: [makeRecentTrack()],
    playlists: [makePlaylist()],
    ...overrides,
  };
}

// ── spotifyBrowse (A16) ──────────────────────────────────────────────────────

describe("spotifyBrowse (A16)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns recently-played tracks and playlists", async () => {
    mockBrowse.mockResolvedValue(makeBrowseResult());

    const result = await spotifyBrowse();

    expect(result.recentlyPlayed).toHaveLength(1);
    expect(result.playlists).toHaveLength(1);

    const track = result.recentlyPlayed[0];
    expect(track.id).toBe("track_abc");
    expect(track.title).toBe("Recently Played Track");
    expect(track.artist).toBe("Some Artist");
    expect(track.albumArtUrl).toBe("https://i.scdn.co/image/recent");
    expect(track.uri).toBe("spotify:track:abc123");

    const playlist = result.playlists[0];
    expect(playlist.id).toBe("playlist_xyz");
    expect(playlist.title).toBe("Made For You Playlist");
    expect(playlist.description).toBe("Your daily mix");
    expect(playlist.imageUrl).toBe("https://i.scdn.co/image/playlist");
    expect(playlist.uri).toBe("spotify:playlist:xyz789");
  });

  it("returns empty arrays when no recently-played or playlists exist", async () => {
    mockBrowse.mockResolvedValue({ recentlyPlayed: [], playlists: [] });

    const result = await spotifyBrowse();

    expect(result.recentlyPlayed).toHaveLength(0);
    expect(result.playlists).toHaveLength(0);
  });

  it("handles null albumArtUrl on recently-played tracks", async () => {
    mockBrowse.mockResolvedValue(
      makeBrowseResult({ recentlyPlayed: [makeRecentTrack({ albumArtUrl: null })] }),
    );

    const result = await spotifyBrowse();

    expect(result.recentlyPlayed[0].albumArtUrl).toBeNull();
  });

  it("handles null description and imageUrl on playlists", async () => {
    mockBrowse.mockResolvedValue(
      makeBrowseResult({
        playlists: [makePlaylist({ description: null, imageUrl: null })],
      }),
    );

    const result = await spotifyBrowse();

    expect(result.playlists[0].description).toBeNull();
    expect(result.playlists[0].imageUrl).toBeNull();
  });

  it("returns multiple recently-played tracks in order", async () => {
    const tracks = [
      makeRecentTrack({ id: "t1", title: "Track 1" }),
      makeRecentTrack({ id: "t2", title: "Track 2" }),
      makeRecentTrack({ id: "t3", title: "Track 3" }),
    ];
    mockBrowse.mockResolvedValue(makeBrowseResult({ recentlyPlayed: tracks }));

    const result = await spotifyBrowse();

    expect(result.recentlyPlayed).toHaveLength(3);
    expect(result.recentlyPlayed[0].id).toBe("t1");
    expect(result.recentlyPlayed[1].id).toBe("t2");
    expect(result.recentlyPlayed[2].id).toBe("t3");
  });

  it("throws SpotifyError when unconfigured (A3)", async () => {
    const { SpotifyError } = await import("@www/core");
    mockBrowse.mockRejectedValue(new SpotifyError("Spotify credentials unconfigured"));

    await expect(spotifyBrowse()).rejects.toThrow("Spotify credentials unconfigured");
  });

  it("throws SpotifyError on upstream API error (A3)", async () => {
    const { SpotifyError } = await import("@www/core");
    mockBrowse.mockRejectedValue(new SpotifyError("browse: HTTP 503 , Service Unavailable"));

    await expect(spotifyBrowse()).rejects.toThrow("HTTP 503");
  });
});

// ── media router integration (A16) ───────────────────────────────────────────

describe("mediaRouter.spotify.browse via tRPC caller (A16)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("exposes spotify.browse query returning real content", async () => {
    mockBrowse.mockResolvedValue(makeBrowseResult());

    const { router } = await import("../trpc/init");
    const { mediaRouter } = await import("../trpc/routers/media");
    const testRouter = router({ media: mediaRouter });
    // @ts-expect-error -- no db context needed for unit tests
    const caller = testRouter.createCaller({});

    const result = await caller.media.spotify.browse();

    expect(result.recentlyPlayed).toHaveLength(1);
    expect(result.playlists).toHaveLength(1);
    expect(result.recentlyPlayed[0].title).toBe("Recently Played Track");
    expect(result.playlists[0].title).toBe("Made For You Playlist");
  });

  it("returns empty arrays on no content via tRPC (A16)", async () => {
    mockBrowse.mockResolvedValue({ recentlyPlayed: [], playlists: [] });

    const { router } = await import("../trpc/init");
    const { mediaRouter } = await import("../trpc/routers/media");
    const testRouter = router({ media: mediaRouter });
    // @ts-expect-error -- no db context needed
    const caller = testRouter.createCaller({});

    const result = await caller.media.spotify.browse();

    expect(result.recentlyPlayed).toHaveLength(0);
    expect(result.playlists).toHaveLength(0);
  });

  it("throws SpotifyError via tRPC when unconfigured (A3)", async () => {
    const { SpotifyError } = await import("@www/core");
    mockBrowse.mockRejectedValue(new SpotifyError("Spotify credentials unconfigured"));

    const { router } = await import("../trpc/init");
    const { mediaRouter } = await import("../trpc/routers/media");
    const testRouter = router({ media: mediaRouter });
    // @ts-expect-error -- no db context needed
    const caller = testRouter.createCaller({});

    await expect(caller.media.spotify.browse()).rejects.toThrow("Spotify credentials unconfigured");
  });
});
