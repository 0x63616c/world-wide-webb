import { z } from "zod";
import {
  CLIMATE_GAP,
  CLIMATE_MAX,
  CLIMATE_MIN,
  getClimate,
  getClimateZones,
  HvacAction,
  HvacMode,
  resolveClimateEntityId,
  setClimateFan,
  setClimateMode,
  setClimatePreset,
  setClimateRange,
  setClimateTarget,
  setZoneMode,
  setZoneRange,
  setZoneTarget,
} from "../../services/climate-service";
import { publicProcedure, router } from "../init";

const ClimateModeSchema = z.enum([HvacMode.Off, HvacMode.Cool, HvacMode.Heat, HvacMode.HeatCool]);
const ClimateActionSchema = z.enum([HvacAction.Cooling, HvacAction.Heating, HvacAction.Idle]);
const setpoint = z.number().int().min(CLIMATE_MIN).max(CLIMATE_MAX);

// Discriminated union on mode , mirrors ClimateState. A single `target` and a
// `targetLow`/`targetHigh` range can never appear together.
const ClimateStateOutput = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal(HvacMode.Off),
    ambient: z.number(),
    action: ClimateActionSchema,
    // Remembered (last reported) setpoints, null when never seen , see ClimateState.
    target: z.number().nullable(),
    targetLow: z.number().nullable(),
    targetHigh: z.number().nullable(),
  }),
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
// values are rejected before any HA call , never an HA 500.
const RangeInput = z
  .object({ low: setpoint, high: setpoint })
  .refine((r) => r.low + CLIMATE_GAP <= r.high, {
    message: `low must be at least ${CLIMATE_GAP}°F below high`,
  });

// Full per-zone capability shape (mirrors ClimateZone in the service). Modes/
// presets/fan modes are passed through as raw HA strings , HA reports more modes
// (fan_only/dry/auto) than the tile's 4-mode union, and the modals tolerate them.
const ClimateZoneOutput = z.object({
  entityId: z.string(),
  name: z.string(),
  ambient: z.number(),
  action: ClimateActionSchema,
  mode: z.string(),
  hvacModes: z.array(z.string()),
  target: z.number().nullable(),
  targetLow: z.number().nullable(),
  targetHigh: z.number().nullable(),
  minTemp: z.number(),
  maxTemp: z.number(),
  presetMode: z.string().nullable(),
  presetModes: z.array(z.string()),
  fanMode: z.string().nullable(),
  fanModes: z.array(z.string()),
});

// Mutations that target an explicit entity (the multi-zone modals act on any
// zone, not just the resolved house thermostat) return the refreshed zones list.
const EntityModeInput = z.object({ entityId: z.string(), mode: ClimateModeSchema });
const EntityTargetInput = z.object({ entityId: z.string(), target: setpoint });
const EntityRangeInput = z
  .object({ entityId: z.string(), low: setpoint, high: setpoint })
  .refine((r) => r.low + CLIMATE_GAP <= r.high, {
    message: `low must be at least ${CLIMATE_GAP}°F below high`,
  });
const EntityPresetInput = z.object({ entityId: z.string(), preset: z.string() });
const EntityFanInput = z.object({ entityId: z.string(), fanMode: z.string() });

export const climateRouter = router({
  get: publicProcedure.output(ClimateStateOutput).query(() => getClimate()),

  zones: publicProcedure.output(z.array(ClimateZoneOutput)).query(() => getClimateZones()),

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

  // ── Entity-parameterized variants for the multi-zone detail modals ──────────
  setModeFor: publicProcedure
    .input(EntityModeInput)
    .output(z.array(ClimateZoneOutput))
    .mutation(({ input }) => setZoneMode(input.entityId, input.mode)),

  setTargetFor: publicProcedure
    .input(EntityTargetInput)
    .output(z.array(ClimateZoneOutput))
    .mutation(({ input }) => setZoneTarget(input.entityId, input.target)),

  setRangeFor: publicProcedure
    .input(EntityRangeInput)
    .output(z.array(ClimateZoneOutput))
    .mutation(({ input }) => setZoneRange(input.entityId, input.low, input.high)),

  setPreset: publicProcedure
    .input(EntityPresetInput)
    .output(z.array(ClimateZoneOutput))
    .mutation(({ input }) => setClimatePreset(input.entityId, input.preset)),

  setFan: publicProcedure
    .input(EntityFanInput)
    .output(z.array(ClimateZoneOutput))
    .mutation(({ input }) => setClimateFan(input.entityId, input.fanMode)),
});
