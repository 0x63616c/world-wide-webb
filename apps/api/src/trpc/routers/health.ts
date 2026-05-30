import { z } from "zod";
import { env } from "../../env";
import { publicProcedure, router } from "../init";

const SERVER_STARTED_AT = new Date().toISOString();

export const healthRouter = router({
  ping: publicProcedure
    .input(z.object({}).optional())
    .output(
      z.object({
        status: z.literal("ok"),
        timestamp: z.number(),
      }),
    )
    .query(() => ({ status: "ok" as const, timestamp: Date.now() })),

  buildHash: publicProcedure
    .input(z.object({}).optional())
    .output(
      z.object({
        hash: z.string(),
        deployedAt: z.string(),
      }),
    )
    .query(() => ({ hash: env.BUILD_HASH, deployedAt: SERVER_STARTED_AT })),
});
