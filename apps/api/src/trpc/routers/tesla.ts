import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getTeslaData } from "../../services/tesla-service";
import { publicProcedure, router } from "../init";

const teslaOutputSchema = z.object({
  name: z.string(),
  nick: z.string(),
  locked: z.boolean(),
  place: z.string(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  charging: z.boolean(),
  rate: z.number(),
  pct: z.number(),
  range: z.number(),
  odo: z.string(),
  climate: z.number(),
});

export const teslaRouter = router({
  get: publicProcedure
    .input(z.object({}).optional())
    .output(teslaOutputSchema)
    .query(async () => {
      try {
        return await getTeslaData();
      } catch (e) {
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: e instanceof Error ? e.message : "Tesla data unavailable",
        });
      }
    }),
});
