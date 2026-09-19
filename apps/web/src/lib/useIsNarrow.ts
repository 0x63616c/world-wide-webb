/**
 * Narrow-viewport probe.
 *
 * The board itself is a fixed 1366x1024 wall panel and deliberately NOT
 * responsive , that invariant stands. Settings was the first surface that had to
 * also work on a phone, because it is the only place the APNs permission prompt
 * can be triggered, and the shell app is installed on a phone as a push client
 * as well as on the wall iPad. The phone view (components/MobileBoard.tsx) is
 * the second, and composes this probe with a user-agent check , see lib/mobile.ts,
 * which owns "is this a phone?" and is what UI code should ask. This module owns
 * only the viewport half: one breakpoint, one subscription.
 *
 * The breakpoint is well below the 1366 panel width and below any iPad width, so
 * the wall panel and iPad can never match it , only a phone does.
 */

import { useSyncExternalStore } from "react";

/** Phones only. iPad portrait is 768+, the wall panel is 1366. */
export const NARROW_MAX_WIDTH = 700;

const QUERY = `(max-width: ${NARROW_MAX_WIDTH}px)`;

function subscribe(onChange: () => void): () => void {
  // matchMedia is absent in the jsdom/test and SSR paths; there is nothing to
  // subscribe to there and getSnapshot already reports false.
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/**
 * The live answer, outside React , for callers that are not components (see
 * lib/mobile.ts's isMobileDevice). Also this hook's own getSnapshot.
 */
export function isNarrowViewport(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(QUERY).matches;
}

/** Server snapshot: never narrow, so the panel layout is the default. */
function getServerSnapshot(): boolean {
  return false;
}

/**
 * True on phone-width viewports. Drives the Settings overlay's single-column
 * drill-down, and the viewport half of lib/mobile.ts's phone check. Ask
 * useIsMobile() instead if the question is "is this a phone?" rather than "is
 * this viewport narrow?".
 */
export function useIsNarrow(): boolean {
  return useSyncExternalStore(subscribe, isNarrowViewport, getServerSnapshot);
}
