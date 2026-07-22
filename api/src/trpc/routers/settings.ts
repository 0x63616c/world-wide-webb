import {
  getSettings,
  settingsPatchSchema,
  settingsSchema,
  updateSettings,
} from "../../services/settings-service";
import { publicProcedure, router } from "../init";

export const settingsRouter = router({
  /**
   * Read the global wall-panel settings. Returns the full Settings object,
   * falling back to defaults when nothing has been persisted yet.
   */
  get: publicProcedure.output(settingsSchema).query(({ ctx }) => getSettings(ctx.db)),

  /**
   * Apply a partial patch to the global settings and return the new full state.
   * Any subset of fields may be sent; omitted fields keep their current value.
   */
  set: publicProcedure
    .input(settingsPatchSchema)
    .output(settingsSchema)
    .mutation(({ ctx, input }) => updateSettings(ctx.db, input)),
});
