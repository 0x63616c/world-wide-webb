import { featureAppRouter } from "@features/_generated/router.gen";
import { mergeRouters, router } from "../init";
import { boothPhotosRouter } from "./booth-photos";
import { cameraRouter } from "./camera";
import { climateRouter } from "./climate";
import { controlsRouter } from "./controls";
import { deviceSettingsRouter } from "./device-settings";
import { eventsRouter } from "./events";
import { githubRouter } from "./github";
import { healthRouter } from "./health";
import { logsRouter } from "./logs";
import { mediaRouter } from "./media";
import { notificationsRouter } from "./notifications";
import { sessionsRouter } from "./sessions";
import { settingsRouter } from "./settings";
import { systemRouter } from "./system";
import { teslaRouter } from "./tesla";
import { wakePhotosRouter } from "./wake-photos";
import { weatherRouter } from "./weather";
import { weightRouter } from "./weight";

// The non-feature (base) router. Feature facets — `portal` now lives in
// features/guest-wifi — are merged in below from the generated aggregate
// (features/_generated/router.gen.ts), so a folded feature's tRPC surface joins
// the app router without a hand-edit here.
const baseRouter = router({
  health: healthRouter,
  weather: weatherRouter,
  notifications: notificationsRouter,
  tesla: teslaRouter,
  climate: climateRouter,
  controls: controlsRouter,
  camera: cameraRouter,
  boothPhotos: boothPhotosRouter,
  events: eventsRouter,
  github: githubRouter,
  logs: logsRouter,
  media: mediaRouter,
  settings: settingsRouter,
  deviceSettings: deviceSettingsRouter,
  system: systemRouter,
  sessions: sessionsRouter,
  wakePhotos: wakePhotosRouter,
  weight: weightRouter,
});

export const appRouter = mergeRouters(baseRouter, featureAppRouter);

export type AppRouter = typeof appRouter;
