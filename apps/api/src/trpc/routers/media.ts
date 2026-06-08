import { z } from "zod";
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
import {
  sonosGrabTvToBeam,
  sonosGroupJoin,
  sonosGroupLeave,
  sonosSetLineIn,
  sonosSetMute,
  sonosSetVolume,
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
});

const SoundSystemRoomSchema = z.object({
  name: z.string(),
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
// (CC-51hf.12 / A14, A15; CC-51hf.13 / A16).
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

// Media router — Apple TV, Sonos, and Spotify queries/mutations.
// Procedures are added per milestone; the router is registered in index.ts so
// typecheck sees it as part of AppRouter from the first milestone (CC-51hf.1).
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

  // ── Sonos write mutations (CC-51hf.10 / A12) ──────────────────────────────

  sonosSetVolume: publicProcedure
    .input(z.object({ deviceIp: z.string(), volume: z.number().int().min(0).max(100) }))
    .mutation(({ input }) => sonosSetVolume(input)),

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

  // ── Sonos favorites query (CC-51hf.11 / A13) ──────────────────────────────

  sonosFavorites: publicProcedure
    .input(z.object({}).optional())
    .output(z.array(SonosFavoriteSchema))
    .query(() => getSonosFavorites()),

  // ── Spotify sub-router (CC-51hf.12 / A14, A15; CC-51hf.13 / A16) ──────────

  spotify: spotifyRouter,
});
