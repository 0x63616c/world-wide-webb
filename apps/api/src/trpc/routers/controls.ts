import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { getControlsState, toggleControl } from "../../services/controls-service";
import { publicProcedure, router } from "../init";

// ─── output schemas ──────────────────────────────────────────────────────────

const lampStateSchema = z.object({
  on: z.boolean().describe("True when at least one lamp is on"),
  count: z.number().int().min(0).describe("Number of lamp entities currently on"),
  sub: z.string().describe('"On" when any lamp is on, "Off" otherwise'),
  pending: z.boolean().describe("True while a command is in-flight and the overlay is active"),
});

const lightStateSchema = z.object({
  on: z.boolean().describe("True when at least one ceiling/overhead light is on"),
  pending: z.boolean().describe("True while a command is in-flight and the overlay is active"),
});

const fanStateSchema = z.object({
  on: z.boolean().describe("True when the fan is running"),
  sub: z.string().describe('Speed label, e.g. "Medium"'),
  pending: z.boolean().describe("True while a command is in-flight and the overlay is active"),
});

const controlsStateSchema = z
  .object({
    lamps: lampStateSchema,
    lights: lightStateSchema,
    fan: fanStateSchema,
  })
  .nullable()
  .describe("Snapshot of all controllable entities: lamps, lights, fan. Null when HA unavailable.");

// ─── router ──────────────────────────────────────────────────────────────────

export const controlsRouter = router({
  /**
   * Returns the current on/off state + sub-labels for lamps, lights, and fan.
   * Returns null when HA is unreachable so the tile renders shimmer.
   */
  list: publicProcedure
    .input(z.object({}).optional())
    .output(controlsStateSchema)
    .query(() => getControlsState()),

  /**
   * Toggle lamps, lights, or fan on or off.
   * Returns merged state (with pending=true) immediately after dispatching
   * to HA so the client can update without waiting for the next poll.
   */
  toggle: publicProcedure
    .input(
      z.object({
        key: z.enum(["lamps", "lights", "fan"]).describe("Which control group to toggle"),
        on: z.boolean().describe("Desired state: true = on, false = off"),
      }),
    )
    .output(controlsStateSchema)
    .mutation(async ({ input }) => {
      try {
        return await toggleControl(input.key, input.on);
      } catch (err) {
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: err instanceof Error ? err.message : "Toggle failed",
          cause: err,
        });
      }
    }),
});
