import { z } from "zod";
import {
  CLIMATE_GAP,
  CLIMATE_MAX,
  CLIMATE_MIN,
  getClimate,
  HvacAction,
  HvacMode,
  resolveClimateEntityId,
  setClimateMode,
  setClimateRange,
  setClimateTarget,
} from "../../services/climate-service";
import { publicProcedure, router } from "../init";

const ClimateModeSchema = z.enum([HvacMode.Off, HvacMode.Cool, HvacMode.Heat, HvacMode.HeatCool]);
const ClimateActionSchema = z.enum([HvacAction.Cooling, HvacAction.Heating, HvacAction.Idle]);
const setpoint = z.number().int().min(CLIMATE_MIN).max(CLIMATE_MAX);

// Discriminated union on mode — mirrors ClimateState. A single `target` and a
// `targetLow`/`targetHigh` range can never appear together.
const ClimateStateOutput = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal(HvacMode.Off), ambient: z.number(), action: ClimateActionSchema }),
  z.object({
    mode: z.literal(HvacMode.Cool),
    target: z.number().int(),
    ambient: z.number(),
    action: ClimateActionSchema,
  }),
  z.object({
    mode: z.literal(HvacMode.Heat),
    target: z.number().int(),
    ambient: z.number(),
    action: ClimateActionSchema,
  }),
  z.object({
    mode: z.literal(HvacMode.HeatCool),
    targetLow: z.number().int(),
    targetHigh: z.number().int(),
    ambient: z.number(),
    action: ClimateActionSchema,
  }),
]);

// Range input is validated server-side (low+GAP <= high, both in band) so bad
// values are rejected before any HA call — never an HA 500.
const RangeInput = z
  .object({ low: setpoint, high: setpoint })
  .refine((r) => r.low + CLIMATE_GAP <= r.high, {
    message: `low must be at least ${CLIMATE_GAP}°F below high`,
  });

export const climateRouter = router({
  get: publicProcedure.output(ClimateStateOutput).query(() => getClimate()),

  setMode: publicProcedure
    .input(ClimateModeSchema)
    .output(ClimateStateOutput)
    .mutation(async ({ input }) => {
      const entityId = await resolveClimateEntityId();
      if (!entityId) throw new Error("Home Assistant is not configured");
      return setClimateMode(entityId, input);
    }),

  setTarget: publicProcedure
    .input(setpoint)
    .output(ClimateStateOutput)
    .mutation(async ({ input }) => {
      const entityId = await resolveClimateEntityId();
      if (!entityId) throw new Error("Home Assistant is not configured");
      return setClimateTarget(entityId, input);
    }),

  setRange: publicProcedure
    .input(RangeInput)
    .output(ClimateStateOutput)
    .mutation(async ({ input }) => {
      const entityId = await resolveClimateEntityId();
      if (!entityId) throw new Error("Home Assistant is not configured");
      return setClimateRange(entityId, input.low, input.high);
    }),
});
