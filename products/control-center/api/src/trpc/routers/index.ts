import { router } from "../init";
import { boothPhotosRouter } from "./booth-photos";
import { cameraRouter } from "./camera";
import { climateRouter } from "./climate";
import { controlsRouter } from "./controls";
import { deviceSettingsRouter } from "./device-settings";
import { eventsRouter } from "./events";
import { githubRouter } from "./github";
import { healthRouter } from "./health";
import { layoutRouter } from "./layout";
import { logsRouter } from "./logs";
import { mediaRouter } from "./media";
import { networkRouter } from "./network";
import { notificationsRouter } from "./notifications";
import { portalRouter } from "./portal";
import { sessionsRouter } from "./sessions";
import { settingsRouter } from "./settings";
import { systemRouter } from "./system";
import { teslaRouter } from "./tesla";
import { wakePhotosRouter } from "./wake-photos";
import { weatherRouter } from "./weather";
import { weightRouter } from "./weight";

export const appRouter = router({
  health: healthRouter,
  weather: weatherRouter,
  network: networkRouter,
  notifications: notificationsRouter,
  tesla: teslaRouter,
  climate: climateRouter,
  controls: controlsRouter,
  camera: cameraRouter,
  boothPhotos: boothPhotosRouter,
  events: eventsRouter,
  github: githubRouter,
  layout: layoutRouter,
  logs: logsRouter,
  media: mediaRouter,
  portal: portalRouter,
  settings: settingsRouter,
  deviceSettings: deviceSettingsRouter,
  system: systemRouter,
  sessions: sessionsRouter,
  wakePhotos: wakePhotosRouter,
  weight: weightRouter,
});

export type AppRouter = typeof appRouter;
