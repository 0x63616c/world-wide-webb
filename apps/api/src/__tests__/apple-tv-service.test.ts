/**
 * Unit tests for the Apple TV service (www-51hf.5, www-51hf.6).
 * Verifies A7: tvNowPlaying maps HA media_player.living_room_tv fields
 * (state, app_name, media_title, media_artist, media_position, media_duration)
 * and classifies source (streaming/line-in/TV/idle).
 * Verifies A3: THROW on HA error / unconfigured.
 * Verifies A8: transport mutations (play/pause/next/previous/stop) and seek
 * via media_player/media_seek on media_player.living_room_tv.
 * All HA calls are mocked — no network required.
 */
import { describe, expect, it, vi } from "vitest";

// ─── mock the HA singleton ────────────────────────────────────────────────────

const { mockIsConfigured, mockGetEntity, mockCallService, mockGetMedia } = vi.hoisted(() => ({
  mockIsConfigured: vi.fn<() => boolean>(),
  mockGetEntity: vi.fn<(entityId: string) => Promise<unknown>>(),
  mockCallService:
    vi.fn<(domain: string, service: string, params: Record<string, unknown>) => Promise<void>>(),
  mockGetMedia: vi.fn<(path: string) => Promise<Response>>(),
}));

vi.mock("../integrations/homeassistant", () => ({
  ha: {
    isConfigured: mockIsConfigured,
    getEntity: mockGetEntity,
    callService: mockCallService,
    getMedia: mockGetMedia,
  },
}));

// ─── import after mock ────────────────────────────────────────────────────────

import {
  getTvNowPlaying,
  tvNext,
  tvPause,
  tvPlay,
  tvPrevious,
  tvRemote,
  tvSeek,
  tvStop,
} from "../services/apple-tv-service";

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

// ─── artwork + position freshness (www-dhhr) ──────────────────────────────────

const ENTITY_PICTURE =
  "/api/media_player_proxy/media_player.living_room_tv?token=secrettok123&cache=9f2a";

describe("getTvNowPlaying — artworkUrl + mediaPositionUpdatedAt (www-dhhr)", () => {
  it("derives a same-origin artworkUrl when entity_picture is present", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntity.mockResolvedValue(
      makeHaEntity("playing", { app_name: "YouTube", entity_picture: ENTITY_PICTURE }),
    );

    const result = await getTvNowPlaying();

    expect(result.artworkUrl).toMatch(/^\/media\/tv-artwork\?v=/);
  });

  it("never leaks the HA access token into the artworkUrl", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntity.mockResolvedValue(
      makeHaEntity("playing", { app_name: "YouTube", entity_picture: ENTITY_PICTURE }),
    );

    const result = await getTvNowPlaying();

    expect(result.artworkUrl).not.toContain("secrettok123");
  });

  it("changes the artworkUrl when entity_picture changes (cache-bust)", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntity.mockResolvedValue(
      makeHaEntity("playing", { app_name: "YouTube", entity_picture: ENTITY_PICTURE }),
    );
    const first = await getTvNowPlaying();

    mockGetEntity.mockResolvedValue(
      makeHaEntity("playing", {
        app_name: "YouTube",
        entity_picture:
          "/api/media_player_proxy/media_player.living_room_tv?token=secrettok123&cache=other",
      }),
    );
    const second = await getTvNowPlaying();

    expect(first.artworkUrl).not.toBe(second.artworkUrl);
  });

  it("returns null artworkUrl when entity_picture is absent", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntity.mockResolvedValue(makeHaEntity("playing", { app_name: "YouTube" }));

    const result = await getTvNowPlaying();

    expect(result.artworkUrl).toBeNull();
  });

  it("maps media_position_updated_at to mediaPositionUpdatedAt", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntity.mockResolvedValue(
      makeHaEntity("playing", {
        media_position: 2,
        media_position_updated_at: "2026-06-09T20:00:00.000000+00:00",
      }),
    );

    const result = await getTvNowPlaying();

    expect(result.mediaPositionUpdatedAt).toBe("2026-06-09T20:00:00.000000+00:00");
  });

  it("returns null mediaPositionUpdatedAt when absent", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntity.mockResolvedValue(makeHaEntity("idle", {}));

    const result = await getTvNowPlaying();

    expect(result.mediaPositionUpdatedAt).toBeNull();
  });
});

describe("getTvArtwork (www-dhhr)", () => {
  it("throws when HA is not configured", async () => {
    mockIsConfigured.mockReturnValue(false);

    const { getTvArtwork } = await import("../services/apple-tv-service");
    await expect(getTvArtwork()).rejects.toThrow("Home Assistant is not configured");
  });

  it("returns null when the entity has no entity_picture", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntity.mockResolvedValue(makeHaEntity("idle", {}));

    const { getTvArtwork } = await import("../services/apple-tv-service");
    await expect(getTvArtwork()).resolves.toBeNull();
  });

  it("fetches the artwork bytes from HA via the entity_picture path", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntity.mockResolvedValue(
      makeHaEntity("playing", { app_name: "YouTube", entity_picture: ENTITY_PICTURE }),
    );
    mockGetMedia.mockResolvedValue(
      new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
        headers: { "content-type": "image/jpeg" },
      }),
    );

    const { getTvArtwork } = await import("../services/apple-tv-service");
    const res = await getTvArtwork();

    expect(mockGetMedia).toHaveBeenCalledWith(ENTITY_PICTURE);
    expect(res).not.toBeNull();
    expect(res?.headers.get("content-type")).toBe("image/jpeg");
  });
});

describe("mediaRouter.tvNowPlaying output keeps artwork + freshness fields (www-dhhr)", () => {
  it("does not strip artworkUrl / mediaPositionUpdatedAt through the output schema", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntity.mockResolvedValue(
      makeHaEntity("playing", {
        app_name: "YouTube",
        entity_picture: ENTITY_PICTURE,
        media_position: 2,
        media_position_updated_at: "2026-06-09T20:00:00.000000+00:00",
      }),
    );

    const { router } = await import("../trpc/init");
    const { mediaRouter } = await import("../trpc/routers/media");
    const appRouter = router({ media: mediaRouter });
    // @ts-expect-error — no db context needed
    const caller = appRouter.createCaller({});

    const result = await caller.media.tvNowPlaying();

    expect(result.artworkUrl).toMatch(/^\/media\/tv-artwork\?v=/);
    expect(result.mediaPositionUpdatedAt).toBe("2026-06-09T20:00:00.000000+00:00");
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

// ─── transport mutations (A8) ─────────────────────────────────────────────────

describe("Apple TV transport mutations (A8)", () => {
  it("tvPlay calls media_player/media_play on living_room_tv", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockCallService.mockResolvedValue(undefined);

    await tvPlay();

    expect(mockCallService).toHaveBeenCalledWith("media_player", "media_play", {
      entity_id: "media_player.living_room_tv",
    });
  });

  it("tvPause calls media_player/media_pause on living_room_tv", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockCallService.mockResolvedValue(undefined);

    await tvPause();

    expect(mockCallService).toHaveBeenCalledWith("media_player", "media_pause", {
      entity_id: "media_player.living_room_tv",
    });
  });

  it("tvNext calls media_player/media_next_track on living_room_tv", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockCallService.mockResolvedValue(undefined);

    await tvNext();

    expect(mockCallService).toHaveBeenCalledWith("media_player", "media_next_track", {
      entity_id: "media_player.living_room_tv",
    });
  });

  it("tvPrevious calls media_player/media_previous_track on living_room_tv", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockCallService.mockResolvedValue(undefined);

    await tvPrevious();

    expect(mockCallService).toHaveBeenCalledWith("media_player", "media_previous_track", {
      entity_id: "media_player.living_room_tv",
    });
  });

  it("tvStop calls media_player/media_stop on living_room_tv", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockCallService.mockResolvedValue(undefined);

    await tvStop();

    expect(mockCallService).toHaveBeenCalledWith("media_player", "media_stop", {
      entity_id: "media_player.living_room_tv",
    });
  });

  it("tvSeek calls media_player/media_seek with seek_position in seconds", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockCallService.mockResolvedValue(undefined);

    await tvSeek(90.5);

    expect(mockCallService).toHaveBeenCalledWith("media_player", "media_seek", {
      entity_id: "media_player.living_room_tv",
      seek_position: 90.5,
    });
  });

  it("transport mutations throw when HA is not configured (A3)", async () => {
    mockIsConfigured.mockReturnValue(false);

    await expect(tvPlay()).rejects.toThrow("Home Assistant is not configured");
    await expect(tvPause()).rejects.toThrow("Home Assistant is not configured");
    await expect(tvNext()).rejects.toThrow("Home Assistant is not configured");
    await expect(tvPrevious()).rejects.toThrow("Home Assistant is not configured");
    await expect(tvStop()).rejects.toThrow("Home Assistant is not configured");
    await expect(tvSeek(0)).rejects.toThrow("Home Assistant is not configured");
  });

  it("transport mutations throw on HA network error (A3)", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockCallService.mockRejectedValue(new Error("Network error"));

    await expect(tvPlay()).rejects.toThrow("Network error");
  });
});

// ─── media router transport mutations (A8) ────────────────────────────────────

describe("mediaRouter transport mutations via tRPC caller (A8)", () => {
  it("exposes tvPlay, tvPause, tvNext, tvPrevious, tvStop, tvSeek mutations", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockCallService.mockResolvedValue(undefined);

    const { router } = await import("../trpc/init");
    const { mediaRouter } = await import("../trpc/routers/media");
    const testRouter = router({ media: mediaRouter });
    // @ts-expect-error — no db context needed
    const caller = testRouter.createCaller({});

    await caller.media.tvPlay();
    expect(mockCallService).toHaveBeenCalledWith("media_player", "media_play", {
      entity_id: "media_player.living_room_tv",
    });

    await caller.media.tvPause();
    expect(mockCallService).toHaveBeenCalledWith("media_player", "media_pause", {
      entity_id: "media_player.living_room_tv",
    });

    await caller.media.tvNext();
    expect(mockCallService).toHaveBeenCalledWith("media_player", "media_next_track", {
      entity_id: "media_player.living_room_tv",
    });

    await caller.media.tvPrevious();
    expect(mockCallService).toHaveBeenCalledWith("media_player", "media_previous_track", {
      entity_id: "media_player.living_room_tv",
    });

    await caller.media.tvStop();
    expect(mockCallService).toHaveBeenCalledWith("media_player", "media_stop", {
      entity_id: "media_player.living_room_tv",
    });

    await caller.media.tvSeek({ seekPositionSeconds: 45 });
    expect(mockCallService).toHaveBeenCalledWith("media_player", "media_seek", {
      entity_id: "media_player.living_room_tv",
      seek_position: 45,
    });
  });
});

// ─── tvRemote D-pad mutation (A9) ─────────────────────────────────────────────

describe("tvRemote D-pad mutation (A9)", () => {
  const REMOTE_ENTITY_ID = "remote.living_room_tv";

  const ALL_COMMANDS = [
    "up",
    "down",
    "left",
    "right",
    "select",
    "menu",
    "home",
    "home_hold",
    "play_pause",
    "power",
  ] as const;

  it("throws when HA is not configured (A3)", async () => {
    mockIsConfigured.mockReturnValue(false);

    await expect(tvRemote("up")).rejects.toThrow("Home Assistant is not configured");
  });

  it("throws on HA network error (A3)", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockCallService.mockRejectedValue(new Error("Network error"));

    await expect(tvRemote("select")).rejects.toThrow("Network error");
  });

  it.each(
    ALL_COMMANDS,
  )("sends remote/%s via remote.send_command on remote.living_room_tv", async (command) => {
    mockIsConfigured.mockReturnValue(true);
    mockCallService.mockResolvedValue(undefined);

    await tvRemote(command);

    expect(mockCallService).toHaveBeenCalledWith("remote", "send_command", {
      entity_id: REMOTE_ENTITY_ID,
      command,
    });
  });
});

// ─── mediaRouter tvRemote mutation (A9) ──────────────────────────────────────

describe("mediaRouter.tvRemote via tRPC caller (A9)", () => {
  it("exposes tvRemote mutation that calls remote.send_command on remote.living_room_tv", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockCallService.mockResolvedValue(undefined);

    const { router } = await import("../trpc/init");
    const { mediaRouter } = await import("../trpc/routers/media");
    const testRouter = router({ media: mediaRouter });
    // @ts-expect-error — no db context needed
    const caller = testRouter.createCaller({});

    await caller.media.tvRemote({ command: "home" });

    expect(mockCallService).toHaveBeenCalledWith("remote", "send_command", {
      entity_id: "remote.living_room_tv",
      command: "home",
    });
  });

  it("rejects when HA is not configured (A3)", async () => {
    mockIsConfigured.mockReturnValue(false);

    const { router } = await import("../trpc/init");
    const { mediaRouter } = await import("../trpc/routers/media");
    const testRouter = router({ media: mediaRouter });
    // @ts-expect-error — no db context needed
    const caller = testRouter.createCaller({});

    await expect(caller.media.tvRemote({ command: "up" })).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });
});

// ─── tvApps query (A10) ──────────────────────────────────────────────────────

describe("getTvApps (A10)", () => {
  it("throws when HA is not configured (A3)", async () => {
    mockIsConfigured.mockReturnValue(false);

    const { getTvApps } = await import("../services/apple-tv-service");
    await expect(getTvApps()).rejects.toThrow("Home Assistant is not configured");
  });

  it("throws when HA getEntity fails (A3)", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntity.mockRejectedValue(new Error("HA network error"));

    const { getTvApps } = await import("../services/apple-tv-service");
    await expect(getTvApps()).rejects.toThrow("HA network error");
  });

  it("returns source_list and currentApp from media_player.living_room_tv (A10)", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntity.mockResolvedValue({
      entity_id: "media_player.living_room_tv",
      state: "playing",
      attributes: {
        source_list: ["Netflix", "YouTube", "Disney+", "Plex", "TV"],
        app_name: "Netflix",
      },
      last_updated: "2024-01-01T00:00:00Z",
    });

    const { getTvApps } = await import("../services/apple-tv-service");
    const result = await getTvApps();

    expect(result.apps).toEqual(["Netflix", "YouTube", "Disney+", "Plex", "TV"]);
    expect(result.currentApp).toBe("Netflix");
  });

  it("returns null currentApp when app_name is absent (A10)", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntity.mockResolvedValue({
      entity_id: "media_player.living_room_tv",
      state: "idle",
      attributes: {
        source_list: ["Netflix", "Plex"],
      },
      last_updated: "2024-01-01T00:00:00Z",
    });

    const { getTvApps } = await import("../services/apple-tv-service");
    const result = await getTvApps();

    expect(result.currentApp).toBeNull();
    expect(result.apps).toEqual(["Netflix", "Plex"]);
  });

  it("returns empty apps array when source_list is absent (A10)", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntity.mockResolvedValue({
      entity_id: "media_player.living_room_tv",
      state: "idle",
      attributes: {},
      last_updated: "2024-01-01T00:00:00Z",
    });

    const { getTvApps } = await import("../services/apple-tv-service");
    const result = await getTvApps();

    expect(result.apps).toEqual([]);
    expect(result.currentApp).toBeNull();
  });

  it("reads media_player.living_room_tv specifically (A10)", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntity.mockResolvedValue({
      entity_id: "media_player.living_room_tv",
      state: "idle",
      attributes: { source_list: [] },
      last_updated: "2024-01-01T00:00:00Z",
    });

    const { getTvApps } = await import("../services/apple-tv-service");
    await getTvApps();

    expect(mockGetEntity).toHaveBeenCalledWith("media_player.living_room_tv");
  });
});

// ─── tvLaunchApp mutation (A10) ───────────────────────────────────────────────

describe("tvLaunchApp (A10)", () => {
  it("throws when HA is not configured (A3)", async () => {
    mockIsConfigured.mockReturnValue(false);

    const { tvLaunchApp } = await import("../services/apple-tv-service");
    await expect(tvLaunchApp("Netflix")).rejects.toThrow("Home Assistant is not configured");
  });

  it("throws on HA network error (A3)", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockCallService.mockRejectedValue(new Error("Network error"));

    const { tvLaunchApp } = await import("../services/apple-tv-service");
    await expect(tvLaunchApp("Netflix")).rejects.toThrow("Network error");
  });

  it("calls media_player/select_source on media_player.living_room_tv (A10)", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockCallService.mockResolvedValue(undefined);

    const { tvLaunchApp } = await import("../services/apple-tv-service");
    await tvLaunchApp("YouTube");

    expect(mockCallService).toHaveBeenCalledWith("media_player", "select_source", {
      entity_id: "media_player.living_room_tv",
      source: "YouTube",
    });
  });

  it("passes the exact app name to select_source (A10)", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockCallService.mockResolvedValue(undefined);

    const { tvLaunchApp } = await import("../services/apple-tv-service");
    await tvLaunchApp("Disney+");

    expect(mockCallService).toHaveBeenCalledWith("media_player", "select_source", {
      entity_id: "media_player.living_room_tv",
      source: "Disney+",
    });
  });
});

// ─── mediaRouter tvApps + tvLaunchApp via tRPC caller (A10) ──────────────────

describe("mediaRouter.tvApps and tvLaunchApp via tRPC caller (A10)", () => {
  it("exposes tvApps as a query returning apps list and currentApp", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntity.mockResolvedValue({
      entity_id: "media_player.living_room_tv",
      state: "playing",
      attributes: {
        source_list: ["Netflix", "Plex", "YouTube"],
        app_name: "Plex",
      },
      last_updated: "2024-01-01T00:00:00Z",
    });

    const { router } = await import("../trpc/init");
    const { mediaRouter } = await import("../trpc/routers/media");
    const testRouter = router({ media: mediaRouter });
    // @ts-expect-error — no db context needed
    const caller = testRouter.createCaller({});

    const result = await caller.media.tvApps();

    expect(result.apps).toEqual(["Netflix", "Plex", "YouTube"]);
    expect(result.currentApp).toBe("Plex");
  });

  it("exposes tvLaunchApp mutation that calls select_source", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockCallService.mockResolvedValue(undefined);

    const { router } = await import("../trpc/init");
    const { mediaRouter } = await import("../trpc/routers/media");
    const testRouter = router({ media: mediaRouter });
    // @ts-expect-error — no db context needed
    const caller = testRouter.createCaller({});

    await caller.media.tvLaunchApp({ app: "Netflix" });

    expect(mockCallService).toHaveBeenCalledWith("media_player", "select_source", {
      entity_id: "media_player.living_room_tv",
      source: "Netflix",
    });
  });

  it("tvApps rejects SERVICE_UNAVAILABLE when HA is not configured (A3)", async () => {
    mockIsConfigured.mockReturnValue(false);

    const { router } = await import("../trpc/init");
    const { mediaRouter } = await import("../trpc/routers/media");
    const testRouter = router({ media: mediaRouter });
    // @ts-expect-error — no db context needed
    const caller = testRouter.createCaller({});

    await expect(caller.media.tvApps()).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });

  it("tvLaunchApp rejects SERVICE_UNAVAILABLE when HA is not configured (A3)", async () => {
    mockIsConfigured.mockReturnValue(false);

    const { router } = await import("../trpc/init");
    const { mediaRouter } = await import("../trpc/routers/media");
    const testRouter = router({ media: mediaRouter });
    // @ts-expect-error — no db context needed
    const caller = testRouter.createCaller({});

    await expect(caller.media.tvLaunchApp({ app: "Netflix" })).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });
});
