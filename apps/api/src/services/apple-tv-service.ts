import { ha } from "../integrations/homeassistant";
import { HaError } from "../integrations/homeassistant/types";

// The HA entity_id for the Apple TV in the living room.
const TV_ENTITY_ID = "media_player.living_room_tv";

// States that mean the device is not actively playing anything.
const IDLE_STATES = new Set(["off", "standby", "idle", "unavailable", "unknown"]);

// Apple TV's "TV" app name (the built-in live TV / cable input app).
const TV_APP_NAME = "TV";

/**
 * Source classification for the Apple TV media player.
 * - streaming: a streaming app (Netflix, YouTube, Plex, Spotify, etc.)
 * - line-in:   an external HDMI input / cable box passthrough (no app name)
 * - TV:        the Apple TV's built-in TV app (live TV / cable input)
 * - idle:      standby, off, or no active session
 */
/** @public — source classification for Apple TV; consumed by media router output schema */
export type TvSource = "streaming" | "line-in" | "TV" | "idle";

export interface TvNowPlaying {
  state: string;
  appName: string | null;
  mediaTitle: string | null;
  mediaArtist: string | null;
  mediaPosition: number | null;
  mediaDuration: number | null;
  source: TvSource;
}

/**
 * Reads the Apple TV's current state from HA media_player.living_room_tv.
 * THROWS HaError on network failure, TRPCError(SERVICE_UNAVAILABLE) when HA is
 * unconfigured (via the haErrorMiddleware in trpc/init).
 */
export async function getTvNowPlaying(): Promise<TvNowPlaying> {
  if (!ha.isConfigured()) {
    throw new HaError(0, "Home Assistant is not configured");
  }

  const entity = await ha.getEntity(TV_ENTITY_ID);
  const attrs = entity.attributes;

  const state = entity.state;
  const appName = (attrs.app_name as string | undefined) ?? null;
  const mediaTitle = (attrs.media_title as string | undefined) ?? null;
  const mediaArtist = (attrs.media_artist as string | undefined) ?? null;
  const mediaPosition = (attrs.media_position as number | undefined) ?? null;
  const mediaDuration = (attrs.media_duration as number | undefined) ?? null;

  const source = classifySource(state, appName, attrs);

  return { state, appName, mediaTitle, mediaArtist, mediaPosition, mediaDuration, source };
}

/**
 * Classifies the Apple TV's active source.
 * Logic:
 *   1. If the device is in an idle/off state → idle.
 *   2. If the app is the built-in "TV" app → TV (live TV / cable).
 *   3. If there is no app_name but a source attribute is present → line-in (HDMI passthrough).
 *   4. Otherwise (a named streaming app is playing) → streaming.
 */
function classifySource(
  state: string,
  appName: string | null,
  attrs: Record<string, unknown>,
): TvSource {
  if (IDLE_STATES.has(state)) {
    return "idle";
  }
  if (appName === TV_APP_NAME) {
    return "TV";
  }
  if (!appName && attrs.source) {
    return "line-in";
  }
  return "streaming";
}

// Guards the HA singleton is configured before every transport mutation.
function assertConfigured(): void {
  if (!ha.isConfigured()) {
    throw new HaError(0, "Home Assistant is not configured");
  }
}

/**
 * Resumes or starts playback on the Apple TV.
 * Calls media_player/media_play on media_player.living_room_tv.
 * THROWS HaError when HA is unconfigured or on network failure.
 */
export async function tvPlay(): Promise<void> {
  assertConfigured();
  await ha.callService("media_player", "media_play", { entity_id: TV_ENTITY_ID });
}

/**
 * Pauses playback on the Apple TV.
 * Calls media_player/media_pause on media_player.living_room_tv.
 * THROWS HaError when HA is unconfigured or on network failure.
 */
export async function tvPause(): Promise<void> {
  assertConfigured();
  await ha.callService("media_player", "media_pause", { entity_id: TV_ENTITY_ID });
}

/**
 * Skips to the next track/chapter on the Apple TV.
 * Calls media_player/media_next_track on media_player.living_room_tv.
 * THROWS HaError when HA is unconfigured or on network failure.
 */
export async function tvNext(): Promise<void> {
  assertConfigured();
  await ha.callService("media_player", "media_next_track", { entity_id: TV_ENTITY_ID });
}

/**
 * Skips to the previous track/chapter on the Apple TV.
 * Calls media_player/media_previous_track on media_player.living_room_tv.
 * THROWS HaError when HA is unconfigured or on network failure.
 */
export async function tvPrevious(): Promise<void> {
  assertConfigured();
  await ha.callService("media_player", "media_previous_track", { entity_id: TV_ENTITY_ID });
}

/**
 * Stops playback on the Apple TV (no resume position retained).
 * Calls media_player/media_stop on media_player.living_room_tv.
 * THROWS HaError when HA is unconfigured or on network failure.
 */
export async function tvStop(): Promise<void> {
  assertConfigured();
  await ha.callService("media_player", "media_stop", { entity_id: TV_ENTITY_ID });
}

/**
 * Seeks to a given position in the currently-playing content.
 * seekPositionSeconds is the absolute position in seconds (fractional OK).
 * Calls media_player/media_seek with seek_position on media_player.living_room_tv.
 * THROWS HaError when HA is unconfigured or on network failure.
 */
export async function tvSeek(seekPositionSeconds: number): Promise<void> {
  assertConfigured();
  await ha.callService("media_player", "media_seek", {
    entity_id: TV_ENTITY_ID,
    seek_position: seekPositionSeconds,
  });
}
