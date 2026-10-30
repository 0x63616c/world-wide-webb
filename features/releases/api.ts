import { defineApi } from "@app-kit";
import { publicProcedure, router, TRPCError } from "@app-kit/server";
import { z } from "zod";
import { appIdSchema } from "./contract";
import { releaseService } from "./service";
export const api = defineApi(
  router({
    releases: router({
      latest: publicProcedure.input(z.object({ app: appIdSchema })).query(async ({ input }) => {
        const release = await releaseService.latest(input.app);
        if (!release) throw new TRPCError({ code: "NOT_FOUND", message: "No release recorded" });
        return release;
      }),
    }),
  }),
);
