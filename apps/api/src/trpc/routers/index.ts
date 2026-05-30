import { router } from "../init";
import { cameraRouter } from "./camera";
import { climateRouter } from "./climate";
import { controlsRouter } from "./controls";
import { eventsRouter } from "./events";
import { healthRouter } from "./health";
import { networkRouter } from "./network";
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
});

export type AppRouter = typeof appRouter;
