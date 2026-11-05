import { defineApi } from "@app-kit";
import { publicProcedure, router, TRPCError } from "@app-kit/server";
import { z } from "zod";
import { librarySchema, mediaReference, playerID, spotifyStateSchema } from "./contract";
import { SpotifyUnavailable, spotifyService } from "./service";

async function perform<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message:
        error instanceof SpotifyUnavailable
          ? error.message
          : "Home Assistant could not complete this music request. Check the connection and try again.",
    });
  }
}
const accepted = z.object({ accepted: z.literal(true) });
export const api = defineApi(
  router({
    spotify: router({
      state: publicProcedure
        .output(spotifyStateSchema)
        .query(() => perform(() => spotifyService.state())),
      browse: publicProcedure
        .input(z.object({ source: playerID, reference: mediaReference.optional() }))
        .output(librarySchema)
        .query(({ input }) => perform(() => spotifyService.browse(input.source, input.reference))),
      play: publicProcedure
        .input(z.object({ room: playerID, reference: mediaReference }))
        .output(accepted)
        .mutation(({ input }) => perform(() => spotifyService.play(input.room, input.reference))),
      transport: publicProcedure
        .input(z.object({ room: playerID, command: z.enum(["play", "pause", "next", "previous"]) }))
        .output(accepted)
        .mutation(({ input }) =>
          perform(() => spotifyService.transport(input.room, input.command)),
        ),
    }),
  }),
);
