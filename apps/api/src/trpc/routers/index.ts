import { featureAppRouter } from "@features/_generated/router.gen";
import { mergeRouters, router } from "../init";
import { deviceSettingsRouter } from "./device-settings";
import { healthRouter } from "./health";
import { settingsRouter } from "./settings";

// The non-feature (base) router. Feature facets — `sessions`/`wakePhotos` live
// in features/wakes, `sound` in features/sound, `boothPhotos` in features/booth
// — are merged in below from the generated aggregate
// (features/_generated/router.gen.ts), so a folded feature's tRPC surface joins
// the app router without a hand-edit here.
const baseRouter = router({
  health: healthRouter,
  settings: settingsRouter,
  deviceSettings: deviceSettingsRouter,
});

export const appRouter = mergeRouters(baseRouter, featureAppRouter);

export type AppRouter = typeof appRouter;
