import type { HaEntity } from "@www/core";
import { describe, expect, it, vi } from "vitest";
import { createSpotifyService, spotifyURI } from "./service";

function entity(entity_id: string, attributes: Record<string, unknown>, state = "idle"): HaEntity {
  return { entity_id, state, attributes, last_updated: "2026-11-05T12:00:00Z" };
}
function setup() {
  const entities = [
    entity("media_player.spotify_calum", { friendly_name: "Spotify" }),
    entity(
      "media_player.living_room",
      {
        friendly_name: "Living Room",
        group_members: ["media_player.living_room", "media_player.kitchen"],
        media_title: "Reported song",
        media_artist: "Reported artist",
      },
      "playing",
    ),
    entity("media_player.kitchen", {
      friendly_name: "Kitchen",
      group_members: ["media_player.living_room", "media_player.kitchen"],
    }),
    entity("media_player.tv", { friendly_name: "TV" }),
  ];
  const client = {
    isConfigured: () => true,
    getEntities: vi.fn(async () => entities),
    callService: vi.fn(async () => {}),
    callServiceWithResponse: vi.fn(async (): Promise<unknown> => ({})),
  };
  return { entities, client, service: createSpotifyService(client) };
}
describe("Spotify via Home Assistant", () => {
  it("only exposes Spotify sources and Sonos rooms with reported metadata", async () => {
    const { service } = setup();
    const state = await service.state();
    expect(state.accounts.map((a) => a.id)).toEqual(["media_player.spotify_calum"]);
    expect(state.rooms.map((a) => a.id)).toEqual([
      "media_player.living_room",
      "media_player.kitchen",
    ]);
    expect(state.rooms[0]).toMatchObject({ title: "Reported song", playing: true });
  });
  it("converts supported share links and rejects unrelated or malformed URLs", () => {
    expect(spotifyURI("https://open.spotify.com/playlist/abc123?si=share")).toBe(
      "spotify:playlist:abc123",
    );
    expect(spotifyURI("https://open.spotify.com/intl-en/album/abc123")).toBe(
      "spotify:album:abc123",
    );
    expect(spotifyURI("spotify:track:abc123")).toBe("spotify:track:abc123");
    for (const input of [
      "https://evil.test/track/abc",
      "https://open.spotify.com.evil.test/track/abc",
      "http://open.spotify.com/track/abc",
      "https://user@open.spotify.com/track/abc",
      "spotify:track:../abc",
    ])
      expect(spotifyURI(input)).toBeNull();
  });
  it("plays on the selected room's current coordinator without regrouping", async () => {
    const { service, client } = setup();
    await service.play("media_player.kitchen", {
      id: "https://open.spotify.com/playlist/abc123",
      type: "playlist",
    });
    expect(client.callService).toHaveBeenCalledExactlyOnceWith("media_player", "play_media", {
      entity_id: "media_player.living_room",
      media_content_id: "spotify:playlist:abc123",
      media_content_type: "music",
    });
    await service.transport("media_player.kitchen", "pause");
    expect(client.callService).toHaveBeenLastCalledWith("media_player", "media_pause", {
      entity_id: "media_player.living_room",
    });
  });
  it("validates browsing and strips arbitrary upstream attributes", async () => {
    const { service, client } = setup();
    client.callServiceWithResponse.mockResolvedValue({
      "media_player.spotify_calum": {
        title: "Playlists",
        media_content_id: "playlists",
        media_content_type: "directory",
        children: [
          {
            title: "My playlist",
            media_content_id: "spotify:playlist:abc",
            media_content_type: "playlist",
            media_class: "playlist",
            can_expand: true,
            can_play: true,
            thumbnail: "https://private.test/?token=secret",
          },
        ],
      },
    });
    const result = await service.browse("media_player.spotify_calum", {
      id: "playlists",
      type: "directory",
    });
    expect(client.callServiceWithResponse).toHaveBeenCalledWith("media_player", "browse_media", {
      entity_id: "media_player.spotify_calum",
      media_content_id: "playlists",
      media_content_type: "directory",
    });
    expect(result.items).toEqual([
      {
        id: "spotify:playlist:abc",
        type: "playlist",
        kind: "playlist",
        title: "My playlist",
        playable: true,
        expandable: true,
      },
    ]);
    await expect(service.browse("media_player.tv")).rejects.toThrow("unavailable");
  });
  it("rejects unavailable rooms, unknown content, and failed upstream acknowledgements", async () => {
    const { service, client, entities } = setup();
    await expect(
      service.play("media_player.kitchen", { id: "https://evil.test/audio", type: "music" }),
    ).rejects.toThrow("Spotify");
    const kitchen = entities.find((item) => item.entity_id === "media_player.kitchen");
    if (!kitchen) throw new Error("Missing room fixture");
    kitchen.state = "unavailable";
    await expect(service.transport("media_player.kitchen", "play")).rejects.toThrow("unavailable");
    expect(client.callService).not.toHaveBeenCalled();
    client.callService.mockRejectedValue(new Error("HA failed"));
    await expect(
      service.play("media_player.living_room", { id: "spotify:track:abc", type: "music" }),
    ).rejects.toThrow("HA failed");
  });
  it("opens Sonos favourites directly, accepting HA's empty root ID", async () => {
    const { service, client } = setup();
    client.callServiceWithResponse.mockResolvedValue({
      "media_player.kitchen": {
        title: "Favorites",
        media_content_id: "",
        media_content_type: "favorites",
        children: [],
      },
    });
    expect(await service.browse("media_player.kitchen")).toEqual({ title: "Favorites", items: [] });
    expect(client.callServiceWithResponse).toHaveBeenCalledWith("media_player", "browse_media", {
      entity_id: "media_player.kitchen",
      media_content_id: "",
      media_content_type: "favorites",
    });
  });
  it("has an honest unconfigured state and no demo library", async () => {
    const { client } = setup();
    client.isConfigured = () => false;
    expect(await createSpotifyService(client).state()).toEqual({
      configured: false,
      accounts: [],
      rooms: [],
    });
    expect(client.getEntities).not.toHaveBeenCalled();
  });
});
