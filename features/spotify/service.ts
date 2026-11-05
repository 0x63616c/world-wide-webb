import { type HaEntity, type HomeAssistantClient, haFromConfig } from "@www/core";
import { ENV } from "@www/platform/env";
import { z } from "zod";
import type { MediaReference, SpotifyState } from "./contract";

type Client = Pick<
  HomeAssistantClient,
  "isConfigured" | "getEntities" | "callService" | "callServiceWithResponse"
>;
const node = z.object({
  title: z.string(),
  media_class: z.string().default("directory"),
  media_content_id: z.string(),
  media_content_type: z.string(),
  can_play: z.boolean().default(false),
  can_expand: z.boolean().default(false),
});
const tree = node.extend({ children: z.array(node).default([]) });
const text = (entity: HaEntity, key: string): string | null => {
  const value = entity.attributes[key];
  return typeof value === "string" && value.length > 0 ? value : null;
};
function isSpotify(entity: HaEntity) {
  return (
    entity.attributes.icon === "mdi:spotify" ||
    /^media_player\.spotify(?:_|$)/.test(entity.entity_id)
  );
}
function members(entity: HaEntity): string[] {
  const result = z
    .array(z.string().regex(/^media_player\.[a-z0-9_]+$/))
    .safeParse(entity.attributes.group_members);
  return result.success ? result.data : [];
}
const available = (entity: HaEntity) => !["unavailable", "unknown"].includes(entity.state);
export class SpotifyUnavailable extends Error {}

/** Accept Spotify's own share URLs and canonical URIs, never arbitrary URLs. */
export function spotifyURI(value: string): string | null {
  const uri = value.trim();
  if (/^spotify:(track|album|playlist|artist|episode|show):[A-Za-z0-9]+$/.test(uri)) return uri;
  try {
    const url = new URL(uri);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "open.spotify.com" ||
      url.username ||
      url.password ||
      url.port
    )
      return null;
    const match = url.pathname.match(
      /^\/(?:intl-[a-z]{2}\/)?(track|album|playlist|artist|episode|show)\/([A-Za-z0-9]+)\/?$/,
    );
    return match ? `spotify:${match[1]}:${match[2]}` : null;
  } catch {
    return null;
  }
}

export function createSpotifyService(client: Client) {
  async function inventory() {
    if (!client.isConfigured())
      throw new SpotifyUnavailable("Connect Home Assistant to use Spotify.");
    return client.getEntities("media_player");
  }
  async function source(id: string) {
    const entity = (await inventory()).find(
      (item) => item.entity_id === id && (isSpotify(item) || members(item).length > 0),
    );
    if (!entity || !available(entity))
      throw new SpotifyUnavailable(
        "This music source is unavailable. Try another room or reconnect it in Home Assistant.",
      );
    return entity;
  }
  async function room(id: string) {
    const entity = await source(id);
    const coordinator = members(entity)[0];
    if (!coordinator) throw new SpotifyUnavailable("Choose a Sonos room to play music.");
    return coordinator;
  }
  return {
    async state(): Promise<SpotifyState> {
      if (!client.isConfigured()) return { configured: false, accounts: [], rooms: [] };
      const entities = await inventory();
      return {
        configured: true,
        accounts: entities.filter(isSpotify).map((entity) => ({
          id: entity.entity_id,
          name: text(entity, "friendly_name") ?? "Spotify",
        })),
        rooms: entities
          .filter((entity) => members(entity).length > 0)
          .map((entity) => ({
            id: entity.entity_id,
            name: text(entity, "friendly_name") ?? entity.entity_id,
            coordinator: members(entity)[0] ?? entity.entity_id,
            available: available(entity),
            playing: entity.state === "playing",
            title: text(entity, "media_title"),
            artist: text(entity, "media_artist"),
          })),
      };
    },
    async browse(sourceID: string, reference?: MediaReference) {
      const entity = await source(sourceID);
      const target = reference ?? (!isSpotify(entity) ? { id: "", type: "favorites" } : undefined);
      const response = await client.callServiceWithResponse("media_player", "browse_media", {
        entity_id: sourceID,
        ...(target ? { media_content_id: target.id, media_content_type: target.type } : {}),
      });
      const result = tree.parse(z.record(z.string(), z.unknown()).parse(response)[sourceID]);
      return {
        title: result.title,
        items: result.children.map((item) => ({
          id: item.media_content_id,
          type: item.media_content_type,
          title: item.title,
          kind: item.media_class,
          playable: item.can_play,
          expandable: item.can_expand,
        })),
      };
    },
    async play(roomID: string, reference: MediaReference) {
      const uri = spotifyURI(reference.id);
      // HA's Sonos favourites are opaque local IDs returned by browse_media.
      const favourite =
        reference.type === "favorite_item_id" && /^[A-Za-z0-9:_/.-]{1,256}$/.test(reference.id);
      if (!uri && !favourite)
        throw new SpotifyUnavailable("Choose a Spotify item or paste its Spotify share link.");
      const coordinator = await room(roomID);
      await client.callService("media_player", "play_media", {
        entity_id: coordinator,
        media_content_id: uri ?? reference.id,
        media_content_type: favourite && !uri ? "favorite_item_id" : "music",
      });
      return { accepted: true as const };
    },
    async transport(roomID: string, command: "play" | "pause" | "next" | "previous") {
      const coordinator = await room(roomID);
      await client.callService(
        "media_player",
        command === "play"
          ? "media_play"
          : command === "pause"
            ? "media_pause"
            : `media_${command}_track`,
        { entity_id: coordinator },
      );
      return { accepted: true as const };
    },
  };
}
const config = ENV.pick("HA_URL", "HA_TOKEN");
export const spotifyService = createSpotifyService(haFromConfig(config));
