import { z } from "zod";
import { db } from "../../db/index";
import { mediaItem, mediaSource } from "../../db/schema";
import { enqueueJob } from "../../jobs/queue";
import {
  getTvApps,
  getTvNowPlaying,
  tvLaunchApp,
  tvNext,
  tvPause,
  tvPlay,
  tvPrevious,
  tvRemote,
  tvSeek,
  tvStop,
} from "../../services/apple-tv-service";
import { getSonosFavorites } from "../../services/sonos-favorites-service";
import { getSoundSystem } from "../../services/sonos-sound-system-service";
import { setSpeakerDesiredVolume } from "../../services/sonos-volume-enforcer-service";
import {
  sonosGrabTvToBeam,
  sonosGroupJoin,
  sonosGroupLeave,
  sonosSetLineIn,
  sonosSetMute,
  sonosTransport,
} from "../../services/sonos-write-service";
import {
  spotifyBrowse,
  spotifyNext,
  spotifyNowPlaying,
  spotifyPause,
  spotifyPlay,
  spotifyPrevious,
  spotifySeek,
} from "../../services/spotify-service";
import { publicProcedure, router } from "../init";

const TvNowPlayingSchema = z.object({
  state: z.string(),
  appName: z.string().nullable(),
  mediaTitle: z.string().nullable(),
  mediaArtist: z.string().nullable(),
  mediaPosition: z.number().nullable(),
  mediaDuration: z.number().nullable(),
  source: z.enum(["streaming", "line-in", "TV", "idle"]),
  artworkUrl: z.string().nullable(),
  mediaPositionUpdatedAt: z.string().nullable(),
});

// Extract a YouTube video ID from a URL or bare ID string.
// Handles: https://youtu.be/<id>, https://www.youtube.com/watch?v=<id>,
// https://youtube.com/shorts/<id>, and bare 11-char IDs.
function parseYoutubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  // Bare ID: 11 alphanumeric chars (YouTube IDs are exactly 11 chars, [A-Za-z0-9_-]).
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.hostname === "youtu.be") return url.pathname.slice(1).split("?")[0] ?? null;
    if (url.hostname.includes("youtube.com")) {
      // /watch?v=<id>
      const v = url.searchParams.get("v");
      if (v) return v;
      // /shorts/<id> or /embed/<id> or /v/<id>
      const parts = url.pathname.split("/").filter(Boolean);
      const idx = parts.findIndex((p) => ["shorts", "embed", "v"].includes(p));
      if (idx !== -1 && parts[idx + 1]) return parts[idx + 1] ?? null;
    }
  } catch {
    // not a valid URL — could be a bare ID already checked above
  }
  return null;
}

/** Stripe-style id generator for media rows. */
function newId(prefix: string): string {
  const hex = Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${prefix}_${hex}`;
}

const SoundSystemRoomSchema = z.object({
  name: z.string(),
  uuid: z.string(),
  deviceIp: z.string(),
  coordinatorUuid: z.string(),
  memberUuids: z.array(z.string()),
  isCoordinator: z.boolean(),
  volume: z.number(),
  muted: z.boolean(),
  transportState: z.string(),
  sourceLabel: z.string().nullable(),
});

const SoundSystemSchema = z.object({
  rooms: z.array(SoundSystemRoomSchema),
});

const SonosFavoriteSchema = z.object({
  title: z.string(),
  uri: z.string(),
  albumArtUri: z.string().nullable(),
});

// Spotify now-playing output schema (A14). isIdle=true when 204 (nothing playing).
const SpotifyPlayerStateSchema = z.object({
  isIdle: z.boolean(),
  isPlaying: z.boolean(),
  trackTitle: z.string().nullable(),
  artist: z.string().nullable(),
  album: z.string().nullable(),
  albumArtUrl: z.string().nullable(),
  progressMs: z.number().nullable(),
  durationMs: z.number().nullable(),
  deviceName: z.string().nullable(),
});

// Spotify browse schemas (A16).
const SpotifyRecentTrackSchema = z.object({
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  albumArtUrl: z.string().nullable(),
  uri: z.string(),
});

const SpotifyPlaylistItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  uri: z.string(),
});

const SpotifyBrowseResultSchema = z.object({
  recentlyPlayed: z.array(SpotifyRecentTrackSchema),
  playlists: z.array(SpotifyPlaylistItemSchema),
});

// Spotify sub-router — nowPlaying query + transport mutations + browse query
// (www-51hf.12 / A14, A15; www-51hf.13 / A16).
const spotifyRouter = router({
  nowPlaying: publicProcedure
    .input(z.object({}).optional())
    .output(SpotifyPlayerStateSchema)
    .query(() => spotifyNowPlaying()),

  browse: publicProcedure
    .input(z.object({}).optional())
    .output(SpotifyBrowseResultSchema)
    .query(() => spotifyBrowse()),

  play: publicProcedure.mutation(() => spotifyPlay()),

  pause: publicProcedure.mutation(() => spotifyPause()),

  next: publicProcedure.mutation(() => spotifyNext()),

  previous: publicProcedure.mutation(() => spotifyPrevious()),

  seek: publicProcedure
    .input(z.object({ positionMs: z.number().int().nonnegative() }))
    .mutation(({ input }) => spotifySeek(input.positionMs)),
});

// Media router — Apple TV, Sonos, Spotify, and media-ingest queries/mutations.
// Procedures are added per milestone; the router is registered in index.ts so
// typecheck sees it as part of AppRouter from the first milestone (www-51hf.1).
export const mediaRouter = router({
  tvNowPlaying: publicProcedure
    .input(z.object({}).optional())
    .output(TvNowPlayingSchema)
    .query(() => getTvNowPlaying()),

  tvPlay: publicProcedure.mutation(() => tvPlay()),

  tvPause: publicProcedure.mutation(() => tvPause()),

  tvNext: publicProcedure.mutation(() => tvNext()),

  tvPrevious: publicProcedure.mutation(() => tvPrevious()),

  tvStop: publicProcedure.mutation(() => tvStop()),

  tvSeek: publicProcedure
    .input(z.object({ seekPositionSeconds: z.number().nonnegative() }))
    .mutation(({ input }) => tvSeek(input.seekPositionSeconds)),

  // Paste-links-in-chat intake path (www-kp4k.3). Accepts an array of raw
  // YouTube URLs or video IDs; dedupes, creates pending media_items, and
  // enqueues youtube_ingest jobs. Idempotent: URLs already in the DB are
  // silently ignored (ON CONFLICT DO NOTHING on yt_video_id).
  addUrls: publicProcedure
    .input(z.object({ urls: z.array(z.string().min(1)).min(1).max(100) }))
    .mutation(async ({ input }) => {
      // Parse + dedupe within this batch — the same URL pasted 6× = 1 job.
      const seen = new Set<string>();
      const videoIds: string[] = [];
      for (const raw of input.urls) {
        const id = parseYoutubeVideoId(raw);
        if (id && !seen.has(id)) {
          seen.add(id);
          videoIds.push(id);
        }
      }

      if (videoIds.length === 0) {
        return { enqueued: 0, skipped: input.urls.length };
      }

      // Ensure the shared adhoc source exists (one per install, created lazily).
      // ON CONFLICT DO NOTHING keeps this idempotent across concurrent calls.
      const adhocSourceId = "src_adhoc";
      await db
        .insert(mediaSource)
        .values({
          id: adhocSourceId,
          kind: "adhoc",
          title: "Ad-hoc URLs",
          enabled: true,
          videoPolicy: "on",
        })
        .onConflictDoNothing();

      let enqueued = 0;
      for (const videoId of videoIds) {
        const rows = await db
          .insert(mediaItem)
          .values({
            id: newId("mi"),
            sourceId: adhocSourceId,
            ytVideoId: videoId,
            rawTitle: videoId, // will be enriched by the ingest handler
            status: "queued",
          })
          .onConflictDoNothing()
          .returning({ id: mediaItem.id });

        // Only enqueue if we actually inserted (not a duplicate).
        if (rows.length > 0 && rows[0]) {
          await enqueueJob("youtube_ingest", {
            mediaItemId: rows[0].id,
            videoId,
            videoPolicy: "on",
          });
          enqueued++;
        }
      }

      return { enqueued, skipped: input.urls.length - enqueued };
    }),

  tvRemote: publicProcedure
    .input(
      z.object({
        command: z.enum([
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
        ]),
      }),
    )
    .mutation(({ input }) => tvRemote(input.command)),

  tvApps: publicProcedure
    .input(z.object({}).optional())
    .output(z.object({ apps: z.array(z.string()), currentApp: z.string().nullable() }))
    .query(() => getTvApps()),

  tvLaunchApp: publicProcedure
    .input(z.object({ app: z.string() }))
    .mutation(({ input }) => tvLaunchApp(input.app)),

  soundSystem: publicProcedure
    .input(z.object({}).optional())
    .output(SoundSystemSchema)
    .query(() => getSoundSystem()),

  // ── Sonos write mutations (www-51hf.10 / A12) ──────────────────────────────

  // Desired-state write (www-5mek): accepted instantly, the 1s sonos-volume-
  // enforcer worker pushes it to the player. No UPnP call on this path.
  sonosSetVolume: publicProcedure
    .input(z.object({ deviceIp: z.string(), volume: z.number().int().min(0).max(100) }))
    .mutation(({ input }) => setSpeakerDesiredVolume(input)),

  sonosSetMute: publicProcedure
    .input(z.object({ deviceIp: z.string(), muted: z.boolean() }))
    .mutation(({ input }) => sonosSetMute(input)),

  sonosTransport: publicProcedure
    .input(
      z.object({
        coordinatorIp: z.string(),
        command: z.enum(["play", "pause", "next", "previous"]),
      }),
    )
    .mutation(({ input }) => sonosTransport(input)),

  sonosGroupJoin: publicProcedure
    .input(z.object({ memberIp: z.string(), coordinatorUuid: z.string().min(1) }))
    .mutation(({ input }) => sonosGroupJoin(input)),

  sonosGroupLeave: publicProcedure
    .input(z.object({ memberIp: z.string(), memberUuid: z.string().min(1) }))
    .mutation(({ input }) => sonosGroupLeave(input)),

  sonosSetLineIn: publicProcedure
    .input(z.object({ deviceIp: z.string(), sourceUuid: z.string().min(1) }))
    .mutation(({ input }) => sonosSetLineIn(input)),

  sonosGrabTvToBeam: publicProcedure
    .input(z.object({ beamIp: z.string(), beamUuid: z.string().min(1) }))
    .mutation(({ input }) => sonosGrabTvToBeam(input)),

  // ── Sonos favorites query (www-51hf.11 / A13) ──────────────────────────────

  sonosFavorites: publicProcedure
    .input(z.object({}).optional())
    .output(z.array(SonosFavoriteSchema))
    .query(() => getSonosFavorites()),

  // ── Spotify sub-router (www-51hf.12 / A14, A15; www-51hf.13 / A16) ──────────

  spotify: spotifyRouter,
});
