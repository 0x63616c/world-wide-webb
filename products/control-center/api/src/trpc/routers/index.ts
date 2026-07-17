import { router } from "../init";
import { cameraRouter } from "./camera";
import { climateRouter } from "./climate";
import { controlsRouter } from "./controls";
import { eventsRouter } from "./events";
import { healthRouter } from "./health";
import { layoutRouter } from "./layout";
import { mediaRouter } from "./media";
import { networkRouter } from "./network";
import { portalRouter } from "./portal";
import { schedulesRouter } from "./schedules";
import { settingsRouter } from "./settings";
import { systemRouter } from "./system";
import { teslaRouter } from "./tesla";
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
  media: mediaRouter,
  portal: portalRouter,
  schedules: schedulesRouter,
  settings: settingsRouter,
  system: systemRouter,
});

export type AppRouter = typeof appRouter;
