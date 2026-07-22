/**
 * camera-model , the production data behind the photo booth camera: the capture-
 * mode segments and the self-timer options. Adapted from the throwaway
 * `photo-booth-designs/camera/camera-shared.ts` prototype, trimmed to exactly
 * what the shipped `BoothCamera` drives (the prototype's design-only
 * `useCapture`/`useReveal` hooks are replaced by the real `useBoothCapture`).
 *
 * The filter list moved to the shared `lib/booth-filters` module (the gallery
 * needs it too, to render a stored filter id); it is re-exported here so the
 * camera components keep importing filters from one place.
 *
 * Mode ids match the api's `booth_photo.mode` column so the selected segment is
 * the `BoothMode` sent on upload with no mapping layer, except "video", a
 * disabled placeholder that never reaches capture.
 */

import type { BoothMode } from "../../../lib/booth-capture";

export type { BoothMode };

/* ------------------------------------------------------------------ filters */

export type { CameraFilter } from "../../../lib/booth-filters";
export { CAMERA_FILTERS, filterById, filterCss } from "../../../lib/booth-filters";

/* -------------------------------------------------------------------- modes */

/** A segment value is a capturable `BoothMode` or the disabled "video" placeholder. */
export type ModeValue = BoothMode | "video";

export interface ModeSegment {
  value: ModeValue;
  label: string;
  /** Video is a visible-but-inert placeholder , the wall panel captures stills only. */
  disabled?: boolean;
}

export const MODE_SEGMENTS: readonly ModeSegment[] = [
  { value: "photo", label: "Photo" },
  { value: "burst", label: "Burst" },
  { value: "four_frame", label: "4-Frame" },
  { value: "gif", label: "GIF" },
  { value: "video", label: "Video", disabled: true },
] as const;

/** True when a chosen segment can actually be captured (everything but "video"). */
export function isCaptureMode(value: ModeValue): value is BoothMode {
  return value !== "video";
}

/* --------------------------------------------------------------- countdowns */

/** Seconds; 0 means the self-timer is off. */
const COUNTDOWN_OPTIONS = [0, 1, 3, 5, 10] as const;
export type CountdownOption = (typeof COUNTDOWN_OPTIONS)[number];

export function countdownLabel(seconds: CountdownOption): string {
  return seconds === 0 ? "Off" : `${seconds}s`;
}

/** Next value in the Off → 1s → 3s → 5s → 10s → Off cycle. */
export function nextCountdown(current: CountdownOption): CountdownOption {
  const i = COUNTDOWN_OPTIONS.indexOf(current);
  return COUNTDOWN_OPTIONS[(i + 1) % COUNTDOWN_OPTIONS.length];
}
