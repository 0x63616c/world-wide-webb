import { router } from "../init";
import { cameraRouter } from "./camera";
import { climateRouter } from "./climate";
import { controlsRouter } from "./controls";
import { eventsRouter } from "./events";
import { healthRouter } from "./health";
import { layoutRouter } from "./layout";
import { logsRouter } from "./logs";
import { mediaRouter } from "./media";
import { networkRouter } from "./network";
import { portalRouter } from "./portal";
import { schedulesRouter } from "./schedules";
import { sessionsRouter } from "./sessions";
import { settingsRouter } from "./settings";
import { systemRouter } from "./system";
import { teslaRouter } from "./tesla";
import { wakePhotosRouter } from "./wake-photos";
import { weatherRouter } from "./weather";

export const appRouter = router({
  health: healthRouter,
  weather: weatherRouter,
  network: networkRouter,
  tesla: teslaRouter,
  climate: climateRouter,
  controls: controlsRouter,
  camera: cameraRouter,
  events: eventsRouter,
  layout: layoutRouter,
  logs: logsRouter,
  media: mediaRouter,
  portal: portalRouter,
  schedules: schedulesRouter,
  settings: settingsRouter,
  system: systemRouter,
  sessions: sessionsRouter,
  wakePhotos: wakePhotosRouter,
});

export type AppRouter = typeof appRouter;
