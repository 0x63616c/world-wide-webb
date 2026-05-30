import { z } from "zod";
import {
  getClimate,
  resolveClimateEntityId,
  setClimateMode,
  setClimateTarget,
} from "../../services/climate-service";
import { publicProcedure, router } from "../init";

const ClimateMode = z.enum(["cool", "auto", "heat"]);

const ClimateStateOutput = z.object({
  target: z.number().int(),
  ambient: z.number(),
  mode: ClimateMode,
  action: z.enum(["Cooling", "Heating", "Auto", "Idle"]),
});

export const climateRouter = router({
  get: publicProcedure.output(ClimateStateOutput).query(() => getClimate()),

  setTarget: publicProcedure
    .input(z.number().int().min(65).max(80))
    .output(ClimateStateOutput)
    .mutation(async ({ input }) => {
      const entityId = await resolveClimateEntityId();
      if (!entityId) {
        // Degrade: return fallback with updated target.
        return { target: input, ambient: 72, mode: "auto" as const, action: "Idle" as const };
      }
      return setClimateTarget(entityId, input);
    }),

  setMode: publicProcedure
    .input(ClimateMode)
    .output(ClimateStateOutput)
    .mutation(async ({ input }) => {
      const entityId = await resolveClimateEntityId();
      if (!entityId) {
        return { target: 70, ambient: 72, mode: input, action: "Idle" as const };
      }
      return setClimateMode(entityId, input);
    }),
});
