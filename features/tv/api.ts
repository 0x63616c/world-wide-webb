/**
 * tRPC `tv` facet (Track C, Wave 6 fold), split out of the shared
 * apps/api/src/trpc/routers/media.ts into features/tv. Procedure names kept
 * VERBATIM (tvNowPlaying, tvPlay, …) , only the mount key changed from
 * `media` to `tv`.
 */
import { defineApi } from "@app-kit";
import { publicProcedure, router } from "@app-kit/server";
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
} from "./service";

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

export const tvRouter = router({
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
});

/**
 * The branded `api` facet. Its single top-level key `tv` is the router
 * namespace the generated app router mounts.
 */
export const api = defineApi(router({ tv: tvRouter }));
