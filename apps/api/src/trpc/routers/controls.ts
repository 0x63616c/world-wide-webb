import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { getControlsState, toggleControl } from "../../services/controls-service";
import { publicProcedure, router } from "../init";

// ─── output schemas ──────────────────────────────────────────────────────────

const lampStateSchema = z.object({
  on: z.boolean().describe("True when at least one lamp is on"),
  count: z.number().int().min(0).describe("Number of lamp entities currently on"),
  sub: z.string().describe('Sub-label, e.g. "2 on · warm"'),
});

const lightStateSchema = z.object({
  on: z.boolean().describe("True when at least one ceiling/overhead light is on"),
});

const fanStateSchema = z.object({
  on: z.boolean().describe("True when the fan is running"),
  sub: z.string().describe('Speed label, e.g. "Medium"'),
});

const controlsStateSchema = z
  .object({
    lamps: lampStateSchema,
    lights: lightStateSchema,
    fan: fanStateSchema,
  })
  .describe("Snapshot of all controllable entities: lamps, lights, fan");

const toggleOutputSchema = z
  .object({ success: z.boolean() })
  .describe("Acknowledgement that the toggle was dispatched to Home Assistant");

// ─── router ──────────────────────────────────────────────────────────────────

export const controlsRouter = router({
  /**
   * Returns the current on/off state + sub-labels for lamps, lights, and fan.
   * Degrades to placeholder data when HA is unreachable.
   */
  list: publicProcedure
    .input(z.object({}).optional())
    .output(controlsStateSchema)
    .query(() => getControlsState()),

  /**
   * Toggle lamps, lights, or fan on or off.
   * Optimistic on the client — this mutation is fire-and-confirm; the caller
   * should re-query `list` to reconcile.
   */
  toggle: publicProcedure
    .input(
      z.object({
        key: z.enum(["lamps", "lights", "fan"]).describe("Which control group to toggle"),
        on: z.boolean().describe("Desired state: true = on, false = off"),
      }),
    )
    .output(toggleOutputSchema)
    .mutation(async ({ input }) => {
      try {
        await toggleControl(input.key, input.on);
      } catch (err) {
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: err instanceof Error ? err.message : "Toggle failed",
          cause: err,
        });
      }
      return { success: true };
    }),
});
