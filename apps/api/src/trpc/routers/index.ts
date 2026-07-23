import { featureAppRouter } from "@features/_generated/router.gen";
import { mergeRouters, router } from "../init";
import { boothPhotosRouter } from "./booth-photos";
import { deviceSettingsRouter } from "./device-settings";
import { healthRouter } from "./health";
import { mediaRouter } from "./media";
import { settingsRouter } from "./settings";
import { systemRouter } from "./system";

// The non-feature (base) router. Feature facets — `portal` now lives in
// features/guest-wifi, `sessions`/`wakePhotos` now live in features/wakes —
// are merged in below from the generated aggregate
// (features/_generated/router.gen.ts), so a folded feature's tRPC surface joins
// the app router without a hand-edit here.
const baseRouter = router({
  health: healthRouter,
  boothPhotos: boothPhotosRouter,
  media: mediaRouter,
  settings: settingsRouter,
  deviceSettings: deviceSettingsRouter,
  system: systemRouter,
});

export const appRouter = mergeRouters(baseRouter, featureAppRouter);

export type AppRouter = typeof appRouter;
