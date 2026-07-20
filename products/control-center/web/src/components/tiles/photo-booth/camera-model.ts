/**
 * camera-model , the production data behind the photo booth camera: the filter
 * list, the capture-mode segments, and the self-timer options. Adapted from the
 * throwaway `photo-booth-designs/camera/camera-shared.ts` prototype, trimmed to
 * exactly what the shipped `BoothCamera` drives (the prototype's design-only
 * `useCapture`/`useReveal` hooks are replaced by the real `useBoothCapture`).
 *
 * Mode ids match the api's `booth_photo.mode` column so the selected segment is
 * the `BoothMode` sent on upload with no mapping layer, except "video", a
 * disabled placeholder that never reaches capture.
 */

import type { BoothMode } from "../../../lib/booth-capture";

export type { BoothMode };

/* ------------------------------------------------------------------ filters */

export interface CameraFilter {
  id: string;
  label: string;
  /** Value fed straight into CSS `filter` on the preview and the baked frame. */
  css: string;
  /** Representative colour for the swatch/dot chrome. */
  swatch: string;
}

/** Live preview filters , pure CSS `filter` chains that read identically once baked. */
export const CAMERA_FILTERS: readonly CameraFilter[] = [
  { id: "none", label: "Original", css: "none", swatch: "#8a8f98" },
  { id: "mono", label: "Mono", css: "grayscale(1) contrast(1.08)", swatch: "#d7d7d7" },
  {
    id: "sepia",
    label: "Sepia",
    css: "sepia(0.7) contrast(1.05) brightness(1.02)",
    swatch: "#b78a5a",
  },
  { id: "vivid", label: "Vivid", css: "saturate(1.75) contrast(1.12)", swatch: "#ff4d7d" },
  {
    id: "cool",
    label: "Cool",
    css: "hue-rotate(-16deg) saturate(1.2) brightness(1.04)",
    swatch: "#4db8ff",
  },
  {
    id: "warm",
    label: "Warm",
    css: "sepia(0.28) saturate(1.4) brightness(1.05) hue-rotate(-8deg)",
    swatch: "#ffab5e",
  },
  {
    id: "noir",
    label: "Noir",
    css: "grayscale(1) contrast(1.45) brightness(0.92)",
    swatch: "#4a4a4a",
  },
] as const;

export function filterById(id: string): CameraFilter {
  return CAMERA_FILTERS.find((f) => f.id === id) ?? CAMERA_FILTERS[0];
}

export function filterCss(id: string): string {
  return filterById(id).css;
}

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
export const COUNTDOWN_OPTIONS = [0, 1, 3, 5, 10] as const;
export type CountdownOption = (typeof COUNTDOWN_OPTIONS)[number];

export function countdownLabel(seconds: CountdownOption): string {
  return seconds === 0 ? "Off" : `${seconds}s`;
}

/** Next value in the Off → 1s → 3s → 5s → 10s → Off cycle. */
export function nextCountdown(current: CountdownOption): CountdownOption {
  const i = COUNTDOWN_OPTIONS.indexOf(current);
  return COUNTDOWN_OPTIONS[(i + 1) % COUNTDOWN_OPTIONS.length];
}
