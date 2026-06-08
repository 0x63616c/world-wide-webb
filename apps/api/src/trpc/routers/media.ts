import { z } from "zod";
import {
  getTvNowPlaying,
  tvNext,
  tvPause,
  tvPlay,
  tvPrevious,
  tvRemote,
  tvSeek,
  tvStop,
} from "../../services/apple-tv-service";
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

// Media router — Apple TV, Sonos, and Spotify queries/mutations.
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
});
