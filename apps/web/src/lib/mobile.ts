/**
 * Phone detection , the single place that answers "is this app running on a
 * phone rather than the wall panel?".
 *
 * Why this exists at all, given "fixed wall panel, 1366x1024, not responsive":
 * the panel is still the only layout the BOARD targets, and that has not
 * changed. But the same bundle (and the same TestFlight build) also gets opened
 * on an iPhone, where a pannable 1366x1024 world, a "please set your device
 * name" setup nag and a dock-power fault banner are all noise , none of them
 * are things you can act on from a phone. A phone gets its own deliberately tiny
 * view instead (components/MobileBoard.tsx); this module is the predicate that
 * routes between the two, so "what counts as a phone" is decided once here
 * instead of being re-sniffed at each call site.
 *
 * Two independent signals, OR'd:
 *
 *   1. The viewport is phone-narrow. Delegated to lib/useIsNarrow.ts, which
 *      already owned that breakpoint for the Settings overlay's drill-down , the
 *      breakpoint and its matchMedia subscription stay in one module rather than
 *      being restated here. This is also what makes the phone view reachable in
 *      a desktop browser (narrow the window) and in Storybook, with no UA
 *      spoofing.
 *   2. The user agent says phone, which catches a phone in LANDSCAPE (~844px
 *      wide, so not narrow) and the native shell installed on an iPhone. iPad is
 *      checked first and always resolves to "not a phone": the wall panel is an
 *      iPad and its UA also contains "Mobile/…", so a naive /Mobile/ test would
 *      route the panel itself into the phone view.
 *
 * Deliberately NOT a pointer/touch media query: the panel, Chrome's device
 * emulation and a touchscreen laptop all report coarse pointers, so it would
 * separate nothing the two checks above don't already separate.
 */

import { isNarrowViewport, NARROW_MAX_WIDTH, useIsNarrow } from "./useIsNarrow";

/**
 * Widest viewport that still counts as a phone. Re-exported from useIsNarrow
 * rather than redeclared, so there is exactly one breakpoint in the app.
 */
export const PHONE_MAX_WIDTH = NARROW_MAX_WIDTH;

/**
 * True iff these navigator values describe a phone. Pure and exported for
 * tests , order matters (see the file header): iPad, the wall panel itself, is
 * excluded before any /Mobile/ test can claim it.
 */
export function isPhoneUserAgent(ua: string, platform: string): boolean {
  const haystack = `${ua} ${platform}`;
  if (/iPad/i.test(haystack)) return false;
  if (/iPhone|iPod/i.test(haystack)) return true;
  // Android phones carry the "Mobile" token; Android TABLETS omit it, which is
  // the only signal Android gives for the difference.
  return /Android/i.test(haystack) && /Mobile/i.test(ua);
}

/** Reads the live navigator, guarded , SSR and locked-down environments. */
function isPhoneNavigator(): boolean {
  try {
    return isPhoneUserAgent(
      navigator.userAgent ?? "",
      // Deprecated but still the most reliable iPad/Mac hint on WebKit; a
      // missing value simply drops out of the haystack (same read as
      // lib/device-name.ts's own derivation).
      navigator.platform ?? "",
    );
  } catch {
    return false;
  }
}

/**
 * The live answer, outside React. Deliberately uncached: the UA half cannot
 * change, but three regexes per call is nothing next to a render, and caching it
 * would need a test-only reset seam to stay testable.
 */
export function isMobileDevice(): boolean {
  return isNarrowViewport() || isPhoneNavigator();
}

/**
 * Subscribe to "am I on a phone?". Re-evaluated whenever the narrow-viewport
 * media query flips (the UA half never changes), so rotating a phone or
 * narrowing a desktop window switches views without a reload.
 */
export function useIsMobile(): boolean {
  // Hook first, unconditionally , `||` would short-circuit it once the UA
  // already says phone and change the hook order between devices.
  const narrow = useIsNarrow();
  return narrow || isPhoneNavigator();
}
