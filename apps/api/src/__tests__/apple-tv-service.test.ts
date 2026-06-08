/**
 * Unit tests for the Apple TV service (www-51hf.5).
 * Verifies A7: tvNowPlaying maps HA media_player.living_room_tv fields
 * (state, app_name, media_title, media_artist, media_position, media_duration)
 * and classifies source (streaming/line-in/TV/idle).
 * Verifies A3: THROW on HA error / unconfigured.
 * All HA calls are mocked — no network required.
 */
import { describe, expect, it, vi } from "vitest";

// ─── mock the HA singleton ────────────────────────────────────────────────────

const { mockIsConfigured, mockGetEntity } = vi.hoisted(() => ({
  mockIsConfigured: vi.fn<() => boolean>(),
  mockGetEntity: vi.fn<(entityId: string) => Promise<unknown>>(),
}));

vi.mock("../integrations/homeassistant", () => ({
  ha: {
    isConfigured: mockIsConfigured,
    getEntity: mockGetEntity,
  },
}));

// ─── import after mock ────────────────────────────────────────────────────────

import { getTvNowPlaying } from "../services/apple-tv-service";

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeHaEntity(state: string, attributes: Record<string, unknown> = {}) {
  return {
    entity_id: "media_player.living_room_tv",
    state,
    attributes,
    last_updated: "2024-01-01T00:00:00Z",
  };
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe("getTvNowPlaying", () => {
  it("throws when HA is not configured (A3)", async () => {
    mockIsConfigured.mockReturnValue(false);

    await expect(getTvNowPlaying()).rejects.toThrow("Home Assistant is not configured");
  });

  it("throws when HA getEntity fails (A3)", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntity.mockRejectedValue(new Error("HA network error"));

    await expect(getTvNowPlaying()).rejects.toThrow("HA network error");
  });

  it("maps state, app_name, title, artist, position, duration from HA entity (A7)", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntity.mockResolvedValue(
      makeHaEntity("playing", {
        app_name: "Netflix",
        media_title: "Stranger Things",
        media_artist: "Episode 1",
        media_position: 123.5,
        media_duration: 3600,
        media_content_type: "video",
      }),
    );

    const result = await getTvNowPlaying();

    expect(result.state).toBe("playing");
    expect(result.appName).toBe("Netflix");
    expect(result.mediaTitle).toBe("Stranger Things");
    expect(result.mediaArtist).toBe("Episode 1");
    expect(result.mediaPosition).toBe(123.5);
    expect(result.mediaDuration).toBe(3600);
  });

  it("classifies source as 'streaming' for a video app (Netflix/Plex/etc.) (A7)", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntity.mockResolvedValue(
      makeHaEntity("playing", {
        app_name: "Netflix",
        media_content_type: "video",
      }),
    );

    const result = await getTvNowPlaying();

    expect(result.source).toBe("streaming");
  });

  it("classifies source as 'streaming' for music app (Spotify on TV) (A7)", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntity.mockResolvedValue(
      makeHaEntity("playing", {
        app_name: "Spotify",
        media_content_type: "music",
      }),
    );

    const result = await getTvNowPlaying();

    expect(result.source).toBe("streaming");
  });

  it("classifies source as 'TV' when app_name indicates live TV (A7)", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntity.mockResolvedValue(
      makeHaEntity("playing", {
        app_name: "TV",
        media_content_type: "tvshow",
      }),
    );

    const result = await getTvNowPlaying();

    expect(result.source).toBe("TV");
  });

  it("classifies source as 'line-in' when HDMI/external input is active (A7)", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntity.mockResolvedValue(
      makeHaEntity("playing", {
        app_name: undefined,
        media_content_type: "channel",
        source: "HDMI 1",
      }),
    );

    const result = await getTvNowPlaying();

    expect(result.source).toBe("line-in");
  });

  it("classifies source as 'idle' when state is standby (A7)", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntity.mockResolvedValue(makeHaEntity("standby", {}));

    const result = await getTvNowPlaying();

    expect(result.source).toBe("idle");
    expect(result.state).toBe("standby");
  });

  it("classifies source as 'idle' when state is 'off' (A7)", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntity.mockResolvedValue(makeHaEntity("off", {}));

    const result = await getTvNowPlaying();

    expect(result.source).toBe("idle");
  });

  it("returns null for optional fields when HA entity has no media playing (A7)", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntity.mockResolvedValue(makeHaEntity("idle", {}));

    const result = await getTvNowPlaying();

    expect(result.appName).toBeNull();
    expect(result.mediaTitle).toBeNull();
    expect(result.mediaArtist).toBeNull();
    expect(result.mediaPosition).toBeNull();
    expect(result.mediaDuration).toBeNull();
  });

  it("reads media_player.living_room_tv specifically (A7)", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntity.mockResolvedValue(makeHaEntity("idle", {}));

    await getTvNowPlaying();

    expect(mockGetEntity).toHaveBeenCalledWith("media_player.living_room_tv");
  });
});

// ─── router integration ───────────────────────────────────────────────────────

describe("mediaRouter.tvNowPlaying via tRPC caller", () => {
  it("exposes tvNowPlaying as a query on the media router (A7)", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntity.mockResolvedValue(
      makeHaEntity("playing", {
        app_name: "YouTube",
        media_title: "Some Video",
        media_position: 45,
        media_duration: 300,
      }),
    );

    const { router } = await import("../trpc/init");
    const { mediaRouter } = await import("../trpc/routers/media");
    const appRouter = router({ media: mediaRouter });
    // @ts-expect-error — no db context needed
    const caller = appRouter.createCaller({});

    const result = await caller.media.tvNowPlaying();

    expect(result.state).toBe("playing");
    expect(result.appName).toBe("YouTube");
    expect(result.source).toBe("streaming");
  });

  it("surfaces SERVICE_UNAVAILABLE when HA is not configured (A3)", async () => {
    mockIsConfigured.mockReturnValue(false);

    const { router } = await import("../trpc/init");
    const { mediaRouter } = await import("../trpc/routers/media");
    const appRouter = router({ media: mediaRouter });
    // @ts-expect-error — no db context needed
    const caller = appRouter.createCaller({});

    await expect(caller.media.tvNowPlaying()).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });
});
