/**
 * One call that turns logging on, made as the very first thing in main.tsx.
 *
 * Ordering matters and is the whole reason this is a module rather than a few
 * lines in main: capture must be installed before any other import can run a
 * console call or throw, or those entries are lost. Everything after it is
 * best-effort setup that cannot fail the boot.
 */

import { BUILD_HASH, BUILD_TIME } from "../../config/build";
import { queryClient } from "../trpc";
import { installCapture } from "./capture";
import { log, startFlushing } from "./logger";
import { installQueryLogging } from "./query-log";
import { requestPersistence } from "./store";

export function initLogging(): void {
  installCapture();
  startFlushing();
  installQueryLogging(queryClient);

  const boot = log.child("boot");
  boot.info("app start", {
    build: BUILD_HASH.slice(0, 7),
    builtAt: Number.isNaN(BUILD_TIME) ? null : new Date(BUILD_TIME).toISOString(),
    // A reload with no navigation entry of type "reload" is a fresh load; the
    // kiosk watchdog's forced reloads show up here as "reload", which is how you
    // tell "the panel restarted itself" from "someone opened the dashboard".
    navigation: performance.getEntriesByType("navigation")[0]?.entryType ?? "unknown",
    reloaded:
      (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)
        ?.type ?? "unknown",
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
  });

  void requestPersistence().then((granted) => {
    boot.info(`storage persistence ${granted ? "granted" : "not granted"}`);
  });
}
