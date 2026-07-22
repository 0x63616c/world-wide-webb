import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  getTeslaData,
  setTeslaCharging,
  setTeslaLock,
  setTeslaPreconditioning,
} from "../../services/tesla-service";
import { publicProcedure, router } from "../init";

const teslaOutputSchema = z.object({
  name: z.string(),
  nick: z.string(),
  locked: z.boolean(),
  place: z.string(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  charging: z.boolean(),
  chargingState: z.string(),
  preconditioning: z.boolean(),
  rate: z.number(),
  pct: z.number(),
  range: z.number(),
  odo: z.string(),
  climate: z.number(),
});

function unavailable(err: unknown, fallback: string): TRPCError {
  return new TRPCError({
    code: "SERVICE_UNAVAILABLE",
    message: err instanceof Error ? err.message : fallback,
    cause: err,
  });
}

export const teslaRouter = router({
  get: publicProcedure
    .input(z.object({}).optional())
    .output(teslaOutputSchema)
    .query(async () => {
      try {
        return await getTeslaData();
      } catch (e) {
        throw unavailable(e, "Tesla data unavailable");
      }
    }),

  /** Lock or unlock the car (lock.<prefix>_lock). */
  setLock: publicProcedure
    .input(z.object({ locked: z.boolean().describe("Desired lock state") }))
    .mutation(async ({ input }) => {
      try {
        await setTeslaLock(input.locked);
      } catch (e) {
        throw unavailable(e, "Tesla lock command failed");
      }
    }),

  /** Start or stop a charge session (switch.<prefix>_charger). */
  setCharging: publicProcedure
    .input(z.object({ on: z.boolean().describe("true = start charge, false = stop") }))
    .mutation(async ({ input }) => {
      try {
        await setTeslaCharging(input.on);
      } catch (e) {
        throw unavailable(e, "Tesla charge command failed");
      }
    }),

  /** Toggle cabin preconditioning via the HVAC climate entity. */
  setPreconditioning: publicProcedure
    .input(z.object({ on: z.boolean().describe("true = precondition on, false = off") }))
    .mutation(async ({ input }) => {
      try {
        await setTeslaPreconditioning(input.on);
      } catch (e) {
        throw unavailable(e, "Tesla preconditioning command failed");
      }
    }),
});
