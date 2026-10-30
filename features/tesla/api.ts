import { defineApi } from "@app-kit";
import { publicProcedure, router, TRPCError, verifyPanelPIN } from "@app-kit/server";
import { z } from "zod";
import { teslaCommandSchema, teslaStateSchema } from "./contract";
import { teslaService } from "./service";

export const api = defineApi(
  router({
    tesla: router({
      state: publicProcedure.output(teslaStateSchema).query(() => teslaService.state()),
      command: publicProcedure
        .input(teslaCommandSchema)
        .output(z.object({ accepted: z.literal(true) }))
        .mutation(async ({ input }) => {
          let allowed: boolean;
          try {
            allowed = await verifyPanelPIN(input.pin);
          } catch {
            throw new TRPCError({
              code: "SERVICE_UNAVAILABLE",
              message: "PIN verification is unavailable.",
            });
          }
          if (!allowed) throw new TRPCError({ code: "FORBIDDEN", message: "PIN not accepted." });
          try {
            return await teslaService.command(input.action);
          } catch {
            throw new TRPCError({
              code: "SERVICE_UNAVAILABLE",
              message: "Tesla command is unavailable.",
            });
          }
        }),
    }),
  }),
);
