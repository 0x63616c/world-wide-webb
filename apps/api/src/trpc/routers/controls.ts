import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { LampMode, LampModeSpeed, LampScene } from "../../config/lamp-scenes";
import {
  ControlKey,
  getControlsState,
  setLampBrightness,
  setLampMode,
  setLampScene,
  toggleControl,
} from "../../services/controls-service";
import { publicProcedure, router } from "../init";

// ─── output schemas ──────────────────────────────────────────────────────────

const lampStateSchema = z.object({
  on: z.boolean().describe("True when at least one lamp is on"),
  count: z.number().int().min(0).describe("Number of lamp entities currently on"),
  brightness: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe("Average brightness pct (0..100) across on-lamps; 0 when none on"),
  sub: z.string().describe('"On" when any lamp is on, "Off" otherwise'),
  pending: z
    .boolean()
    .describe(
      "Always false — lamps are desired-authoritative and never show a pending cue (CC-uq58)",
    ),
  activeScene: z
    .enum([LampScene.White, LampScene.Mood, LampScene.Red, LampScene.Blue, LampMode.Party])
    .nullable()
    .describe(
      "The active lamp scene: 'party' when the lamp_mode row is set, else the colour scene every on-lamp agrees on (from desired colours; a MOOD_PALETTE colour on every lamp reads as 'mood'); null when no mode and lamps disagree, are off, or show a custom colour",
    ),
});

const lightStateSchema = z.object({
  on: z.boolean().describe("True when at least one ceiling/overhead light is on"),
  pending: z
    .boolean()
    .describe(
      "Always false — lights are desired-authoritative and never show a pending cue (CC-uq58)",
    ),
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
  .describe(
    "Snapshot of all controllable entities: lamps, lights, fan. Throws SERVICE_UNAVAILABLE when HA is unreachable (tile shimmers via error state).",
  );

// ─── router ──────────────────────────────────────────────────────────────────

export const controlsRouter = router({
  /**
   * Returns the current on/off state + sub-labels for lamps, lights, and fan.
   * Throws SERVICE_UNAVAILABLE when HA is unreachable so the tile shimmers via
   * React Query error state (CC-355t.30: aligned with THROW-on-unavailable convention).
   */
  list: publicProcedure
    .input(z.object({}).optional())
    .output(controlsStateSchema)
    .query(async () => {
      try {
        return await getControlsState();
      } catch (err) {
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: err instanceof Error ? err.message : "Controls unavailable",
          cause: err,
        });
      }
    }),

  /**
   * Toggle lamps, lights, or fan on or off.
   * Returns merged state (with pending=true) immediately after dispatching
   * to HA so the client can update without waiting for the next poll.
   */
  toggle: publicProcedure
    .input(
      z.object({
        key: z
          .enum([ControlKey.Lamps, ControlKey.Lights, ControlKey.Fan])
          .describe("Which control group to toggle"),
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

  /**
   * Apply a colour scene to every lamp. "mood" gives each lamp a distinct
   * palette colour; white/red/blue are uniform. Returns merged state.
   */
  setLampScene: publicProcedure
    .input(
      z.object({
        scene: z
          .enum([LampScene.White, LampScene.Mood, LampScene.Red, LampScene.Blue])
          .describe("Lamp colour scene to apply across all lamps"),
      }),
    )
    .output(controlsStateSchema)
    .mutation(async ({ input }) => {
      try {
        return await setLampScene(input.scene);
      } catch (err) {
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: err instanceof Error ? err.message : "Set lamp scene failed",
          cause: err,
        });
      }
    }),

  /**
   * Set brightness (0..100 %) on every lamp. Returns merged state.
   */
  setLampBrightness: publicProcedure
    .input(
      z.object({
        pct: z.number().int().min(0).max(100).describe("Lamp brightness percentage, 0..100"),
      }),
    )
    .output(controlsStateSchema)
    .mutation(async ({ input }) => {
      try {
        return await setLampBrightness(input.pct);
      } catch (err) {
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: err instanceof Error ? err.message : "Set lamp brightness failed",
          cause: err,
        });
      }
    }),

  /**
   * Set the persistent lamp mode ("none" | "party"). The party worker reconciles
   * the lamp_mode row, so this records intent and returns the merged state (with
   * activeScene='party' once the row is set). Starting party with no lamps on is a
   * no-op. Returns merged state. (CC-7d5b.3.4)
   */
  setLampMode: publicProcedure
    .input(
      z.object({
        mode: z
          .enum([LampMode.None, LampMode.Party])
          .describe("Lamp mode: 'none' clears any animation, 'party' starts the colour wave"),
        speed: z
          .enum([LampModeSpeed.Slow, LampModeSpeed.Medium, LampModeSpeed.Fast])
          .optional()
          .describe("Animation speed for animated modes (optional)"),
      }),
    )
    .output(controlsStateSchema)
    .mutation(async ({ input }) => {
      try {
        return await setLampMode(input.mode, input.speed);
      } catch (err) {
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: err instanceof Error ? err.message : "Set lamp mode failed",
          cause: err,
        });
      }
    }),
});
