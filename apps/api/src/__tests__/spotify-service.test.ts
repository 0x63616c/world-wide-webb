/**
 * Unit tests for the Spotify service layer (www-51hf.12).
 * Verifies A14: nowPlaying query maps real Spotify player state (track/artist/album/art/
 *   progress/duration/is_playing/device.name) and maps 204 → explicit idle.
 * Verifies A15: transport mutations (play/pause/next/previous/seek).
 * Verifies A3: THROW on unconfigured or upstream error , no fake data.
 * All SpotifyClient calls are mocked , tests never reach the Spotify API.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// ── mock SpotifyClient ──────────────────────────────────────────────────────

const { mockGetNowPlaying, mockPlay, mockPause, mockNext, mockPrevious, mockSeek } = vi.hoisted(
  () => ({
    mockGetNowPlaying: vi.fn(),
    mockPlay: vi.fn(),
    mockPause: vi.fn(),
    mockNext: vi.fn(),
    mockPrevious: vi.fn(),
    mockSeek: vi.fn(),
  }),
);

vi.mock("@www/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@www/core")>()),
  SpotifyClient: vi.fn().mockImplementation(() => ({
    getNowPlaying: mockGetNowPlaying,
    play: mockPlay,
    pause: mockPause,
    next: mockNext,
    previous: mockPrevious,
    seek: mockSeek,
  })),
  SpotifyError: class SpotifyError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "SpotifyError";
    }
  },
}));

// ── import after mock ───────────────────────────────────────────────────────

import {
  spotifyNext,
  spotifyNowPlaying,
  spotifyPause,
  spotifyPlay,
  spotifyPrevious,
  spotifySeek,
} from "../services/spotify-service";

// ── helpers ─────────────────────────────────────────────────────────────────

function makeNowPlaying(overrides: Record<string, unknown> = {}) {
  return {
    isPlaying: true,
    trackTitle: "Test Track",
    artist: "Test Artist",
    album: "Test Album",
    albumArtUrl: "https://i.scdn.co/image/test",
    progressMs: 60_000,
    durationMs: 240_000,
    deviceName: "Living Room Speaker",
    ...overrides,
  };
}

// ── spotifyNowPlaying (A14) ──────────────────────────────────────────────────

describe("spotifyNowPlaying (A14)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns mapped now-playing state when track is playing", async () => {
    mockGetNowPlaying.mockResolvedValue(makeNowPlaying());

    const result = await spotifyNowPlaying();

    expect(result.isIdle).toBe(false);
    expect(result.isPlaying).toBe(true);
    expect(result.trackTitle).toBe("Test Track");
    expect(result.artist).toBe("Test Artist");
    expect(result.album).toBe("Test Album");
    expect(result.albumArtUrl).toBe("https://i.scdn.co/image/test");
    expect(result.progressMs).toBe(60_000);
    expect(result.durationMs).toBe(240_000);
    expect(result.deviceName).toBe("Living Room Speaker");
  });

  it("returns explicit idle state when nothing is playing (204 -> null)", async () => {
    // SpotifyClient.getNowPlaying returns null on 204 No Content
    mockGetNowPlaying.mockResolvedValue(null);

    const result = await spotifyNowPlaying();

    expect(result.isIdle).toBe(true);
    expect(result.isPlaying).toBe(false);
    expect(result.trackTitle).toBeNull();
    expect(result.artist).toBeNull();
    expect(result.album).toBeNull();
    expect(result.albumArtUrl).toBeNull();
    expect(result.progressMs).toBeNull();
    expect(result.durationMs).toBeNull();
    expect(result.deviceName).toBeNull();
  });

  it("maps is_playing=false (paused) correctly", async () => {
    mockGetNowPlaying.mockResolvedValue(makeNowPlaying({ isPlaying: false }));

    const result = await spotifyNowPlaying();

    expect(result.isIdle).toBe(false);
    expect(result.isPlaying).toBe(false);
  });

  it("maps null albumArtUrl when no album art available", async () => {
    mockGetNowPlaying.mockResolvedValue(makeNowPlaying({ albumArtUrl: null }));

    const result = await spotifyNowPlaying();

    expect(result.albumArtUrl).toBeNull();
    expect(result.isIdle).toBe(false);
  });

  it("maps null deviceName when device info is absent", async () => {
    mockGetNowPlaying.mockResolvedValue(makeNowPlaying({ deviceName: null }));

    const result = await spotifyNowPlaying();

    expect(result.deviceName).toBeNull();
  });

  it("throws SpotifyError when unconfigured (A3)", async () => {
    const { SpotifyError } = await import("@www/core");
    mockGetNowPlaying.mockRejectedValue(new SpotifyError("Spotify credentials unconfigured"));

    await expect(spotifyNowPlaying()).rejects.toThrow("Spotify credentials unconfigured");
  });

  it("throws on upstream Spotify API error (A3)", async () => {
    const { SpotifyError } = await import("@www/core");
    mockGetNowPlaying.mockRejectedValue(
      new SpotifyError("getNowPlaying: HTTP 503 -- Service Unavailable"),
    );

    await expect(spotifyNowPlaying()).rejects.toThrow("HTTP 503");
  });
});

// ── Spotify transport mutations (A15) ────────────────────────────────────────

describe("spotifyPlay (A15)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("calls client.play and succeeds", async () => {
    mockPlay.mockResolvedValue(undefined);

    await expect(spotifyPlay()).resolves.toBeUndefined();
    expect(mockPlay).toHaveBeenCalledOnce();
  });

  it("throws SpotifyError when unconfigured (A3)", async () => {
    const { SpotifyError } = await import("@www/core");
    mockPlay.mockRejectedValue(new SpotifyError("Spotify credentials unconfigured"));

    await expect(spotifyPlay()).rejects.toThrow("Spotify credentials unconfigured");
  });

  it("throws on upstream error (A3)", async () => {
    const { SpotifyError } = await import("@www/core");
    mockPlay.mockRejectedValue(new SpotifyError("play: HTTP 403"));

    await expect(spotifyPlay()).rejects.toThrow("HTTP 403");
  });
});

describe("spotifyPause (A15)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("calls client.pause and succeeds", async () => {
    mockPause.mockResolvedValue(undefined);

    await expect(spotifyPause()).resolves.toBeUndefined();
    expect(mockPause).toHaveBeenCalledOnce();
  });

  it("throws SpotifyError when unconfigured (A3)", async () => {
    const { SpotifyError } = await import("@www/core");
    mockPause.mockRejectedValue(new SpotifyError("Spotify credentials unconfigured"));

    await expect(spotifyPause()).rejects.toThrow("Spotify credentials unconfigured");
  });
});

describe("spotifyNext (A15)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("calls client.next and succeeds", async () => {
    mockNext.mockResolvedValue(undefined);

    await expect(spotifyNext()).resolves.toBeUndefined();
    expect(mockNext).toHaveBeenCalledOnce();
  });

  it("throws SpotifyError when unconfigured (A3)", async () => {
    const { SpotifyError } = await import("@www/core");
    mockNext.mockRejectedValue(new SpotifyError("Spotify credentials unconfigured"));

    await expect(spotifyNext()).rejects.toThrow("Spotify credentials unconfigured");
  });
});

describe("spotifyPrevious (A15)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("calls client.previous and succeeds", async () => {
    mockPrevious.mockResolvedValue(undefined);

    await expect(spotifyPrevious()).resolves.toBeUndefined();
    expect(mockPrevious).toHaveBeenCalledOnce();
  });

  it("throws SpotifyError when unconfigured (A3)", async () => {
    const { SpotifyError } = await import("@www/core");
    mockPrevious.mockRejectedValue(new SpotifyError("Spotify credentials unconfigured"));

    await expect(spotifyPrevious()).rejects.toThrow("Spotify credentials unconfigured");
  });
});

describe("spotifySeek (A15)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("calls client.seek with positionMs and succeeds", async () => {
    mockSeek.mockResolvedValue(undefined);

    await expect(spotifySeek(30_000)).resolves.toBeUndefined();
    expect(mockSeek).toHaveBeenCalledWith(30_000);
  });

  it("passes the exact positionMs to client.seek", async () => {
    mockSeek.mockResolvedValue(undefined);

    await spotifySeek(123_456);

    expect(mockSeek).toHaveBeenCalledWith(123_456);
  });

  it("throws SpotifyError when unconfigured (A3)", async () => {
    const { SpotifyError } = await import("@www/core");
    mockSeek.mockRejectedValue(new SpotifyError("Spotify credentials unconfigured"));

    await expect(spotifySeek(0)).rejects.toThrow("Spotify credentials unconfigured");
  });

  it("throws on upstream error (A3)", async () => {
    const { SpotifyError } = await import("@www/core");
    mockSeek.mockRejectedValue(new SpotifyError("seek: HTTP 403"));

    await expect(spotifySeek(5000)).rejects.toThrow("HTTP 403");
  });
});

// ── media router integration (A14, A15) ──────────────────────────────────────

describe("mediaRouter.spotify.nowPlaying via tRPC caller (A14)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns mapped now-playing state via the tRPC media router", async () => {
    mockGetNowPlaying.mockResolvedValue(makeNowPlaying());

    const { router } = await import("../trpc/init");
    const { mediaRouter } = await import("../trpc/routers/media");
    const testRouter = router({ media: mediaRouter });
    // @ts-expect-error -- no db context needed for unit tests
    const caller = testRouter.createCaller({});

    const result = await caller.media.spotify.nowPlaying();

    expect(result.isIdle).toBe(false);
    expect(result.isPlaying).toBe(true);
    expect(result.trackTitle).toBe("Test Track");
    expect(result.artist).toBe("Test Artist");
    expect(result.progressMs).toBe(60_000);
    expect(result.durationMs).toBe(240_000);
    expect(result.deviceName).toBe("Living Room Speaker");
  });

  it("returns idle state on 204 (null from client) via tRPC (A14)", async () => {
    mockGetNowPlaying.mockResolvedValue(null);

    const { router } = await import("../trpc/init");
    const { mediaRouter } = await import("../trpc/routers/media");
    const testRouter = router({ media: mediaRouter });
    // @ts-expect-error -- no db context needed
    const caller = testRouter.createCaller({});

    const result = await caller.media.spotify.nowPlaying();

    expect(result.isIdle).toBe(true);
    expect(result.isPlaying).toBe(false);
    expect(result.trackTitle).toBeNull();
  });
});

describe("mediaRouter.spotify transport mutations via tRPC caller (A15)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("exposes spotify.play mutation", async () => {
    mockPlay.mockResolvedValue(undefined);

    const { router } = await import("../trpc/init");
    const { mediaRouter } = await import("../trpc/routers/media");
    const testRouter = router({ media: mediaRouter });
    // @ts-expect-error -- no db context needed
    const caller = testRouter.createCaller({});

    await caller.media.spotify.play();

    expect(mockPlay).toHaveBeenCalledOnce();
  });

  it("exposes spotify.pause mutation", async () => {
    mockPause.mockResolvedValue(undefined);

    const { router } = await import("../trpc/init");
    const { mediaRouter } = await import("../trpc/routers/media");
    const testRouter = router({ media: mediaRouter });
    // @ts-expect-error -- no db context needed
    const caller = testRouter.createCaller({});

    await caller.media.spotify.pause();

    expect(mockPause).toHaveBeenCalledOnce();
  });

  it("exposes spotify.next mutation", async () => {
    mockNext.mockResolvedValue(undefined);

    const { router } = await import("../trpc/init");
    const { mediaRouter } = await import("../trpc/routers/media");
    const testRouter = router({ media: mediaRouter });
    // @ts-expect-error -- no db context needed
    const caller = testRouter.createCaller({});

    await caller.media.spotify.next();

    expect(mockNext).toHaveBeenCalledOnce();
  });

  it("exposes spotify.previous mutation", async () => {
    mockPrevious.mockResolvedValue(undefined);

    const { router } = await import("../trpc/init");
    const { mediaRouter } = await import("../trpc/routers/media");
    const testRouter = router({ media: mediaRouter });
    // @ts-expect-error -- no db context needed
    const caller = testRouter.createCaller({});

    await caller.media.spotify.previous();

    expect(mockPrevious).toHaveBeenCalledOnce();
  });

  it("exposes spotify.seek mutation with positionMs input", async () => {
    mockSeek.mockResolvedValue(undefined);

    const { router } = await import("../trpc/init");
    const { mediaRouter } = await import("../trpc/routers/media");
    const testRouter = router({ media: mediaRouter });
    // @ts-expect-error -- no db context needed
    const caller = testRouter.createCaller({});

    await caller.media.spotify.seek({ positionMs: 45_000 });

    expect(mockSeek).toHaveBeenCalledWith(45_000);
  });
});
