import { defineApi } from "@app-kit";
import { publicProcedure, router } from "@app-kit/server";
import { z } from "zod";
import { LampMode, LampModeSpeed, LampScene } from "./lamp-scenes";
import {
  ControlKey,
  getControlsState,
  setLampBrightness,
  setLampMode,
  setLampScene,
  toggleControl,
} from "./service";

// Error mapping is deliberately thinner than the deleted per-procedure catches
// (Track B hygiene strip): haErrorMiddleware (init.ts) maps HaError to
// SERVICE_UNAVAILABLE, but a non-HA failure (e.g. a device_state DB error) now
// surfaces as INTERNAL_SERVER_ERROR instead of the old blanket 503. Intended:
// only HA being unreachable is a "service unavailable" condition.

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
      "Always false , lamps are desired-authoritative and never show a pending cue (www-uq58)",
    ),
  activeScene: z
    .enum([LampScene.White, LampScene.Mood, LampScene.Red, LampScene.Blue, LampMode.Party])
    .nullable()
    .describe(
      "The active lamp scene: 'party' when the lamp_mode row is set, else the color scene every on-lamp agrees on (from desired colors; a MOOD_PALETTE color on every lamp reads as 'mood'); null when no mode and lamps disagree, are off, or show a custom color",
    ),
});

const lightStateSchema = z.object({
  on: z.boolean().describe("True when at least one ceiling/overhead light is on"),
  pending: z
    .boolean()
    .describe(
      "Always false , lights are desired-authoritative and never show a pending cue (www-uq58)",
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
   * React Query error state (www-355t.30: aligned with THROW-on-unavailable convention).
   */
  list: publicProcedure
    .input(z.object({}).optional())
    .output(controlsStateSchema)
    .query(async () => {
      return await getControlsState();
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
      return await toggleControl(input.key, input.on);
    }),

  /**
   * Apply a color scene to every lamp. "mood" gives each lamp a distinct
   * palette color; white/red/blue are uniform. Returns merged state.
   */
  setLampScene: publicProcedure
    .input(
      z.object({
        scene: z
          .enum([LampScene.White, LampScene.Mood, LampScene.Red, LampScene.Blue])
          .describe("Lamp color scene to apply across all lamps"),
      }),
    )
    .output(controlsStateSchema)
    .mutation(async ({ input }) => {
      return await setLampScene(input.scene);
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
      return await setLampBrightness(input.pct);
    }),

  /**
   * Set the persistent lamp mode ("none" | "party"). The party worker reconciles
   * the lamp_mode row, so this records intent and returns the merged state (with
   * activeScene='party' once the row is set). Starting party with no lamps on is a
   * no-op. Returns merged state. (www-7d5b.3.4)
   */
  setLampMode: publicProcedure
    .input(
      z.object({
        mode: z
          .enum([LampMode.None, LampMode.Party])
          .describe("Lamp mode: 'none' clears any animation, 'party' starts the color wave"),
        speed: z
          .enum([LampModeSpeed.Slow, LampModeSpeed.Medium, LampModeSpeed.Fast])
          .optional()
          .describe("Animation speed for animated modes (optional)"),
      }),
    )
    .output(controlsStateSchema)
    .mutation(async ({ input }) => {
      return await setLampMode(input.mode, input.speed);
    }),
});

/**
 * The branded `api` facet. Its single top-level key `controls` is the router
 * namespace the generated app router mounts. The codegen reads these keys off
 * `api._def.record`.
 */
export const api = defineApi(router({ controls: controlsRouter }));
