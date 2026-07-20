import { z } from "zod";

import {
  deviceIdSchema,
  deviceSettingsPatchSchema,
  deviceSettingsSchema,
  getDeviceSettings,
  updateDeviceSettings,
} from "../../services/device-settings-service";
import { publicProcedure, router } from "../init";

export const deviceSettingsRouter = router({
  /**
   * Read one panel's settings. Returns the full object, falling back to defaults
   * for a device that has never persisted anything.
   */
  get: publicProcedure
    .input(z.object({ deviceId: deviceIdSchema }))
    .output(deviceSettingsSchema)
    .query(({ ctx, input }) => getDeviceSettings(ctx.db, input.deviceId)),

  /**
   * Apply a partial patch to one panel's settings and return the new full state.
   * Any subset of fields may be sent; omitted fields keep their current value.
   */
  set: publicProcedure
    .input(z.object({ deviceId: deviceIdSchema, patch: deviceSettingsPatchSchema }))
    .output(deviceSettingsSchema)
    .mutation(({ ctx, input }) => updateDeviceSettings(ctx.db, input.deviceId, input.patch)),
});
