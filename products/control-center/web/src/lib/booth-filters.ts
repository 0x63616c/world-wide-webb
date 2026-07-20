/**
 * booth-filters , the shared id->CSS map for the photo booth's non-destructive
 * filters. Both halves of the feature read it: the camera (live preview + swatch
 * chrome, via camera-model which re-exports these) and the gallery (applies a
 * stored filter id as a CSS `filter` at display time, and bakes it into pixels
 * for share/export).
 *
 * Filters are pure CSS `filter` chains chosen so the live preview, the display-
 * time render, and a baked export all read identically. Ids are snake_case slugs
 * matching the api's BOOTH_FILTER_PATTERN (^[a-z0-9_]{1,32}$), so the id the
 * camera sends on upload is stored verbatim and mapped back to CSS here , the
 * backend never needs a lookup table. "none" is the UI's unfiltered sentinel and
 * is never stored (an unfiltered capture's `filter` is null).
 */

export interface CameraFilter {
  id: string;
  label: string;
  /** Value fed straight into CSS `filter` on the preview, a display cell, and a baked export. */
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

/** CSS `filter` for a filter id; an unknown id falls back to the unfiltered look. */
export function filterCss(id: string): string {
  return filterById(id).css;
}

/**
 * CSS `filter` for a stored filter id that may be absent. Null/undefined (an
 * unfiltered capture) and the "none" sentinel both yield "none", so a gallery
 * cell can feed the result straight into `filter:` without branching.
 */
export function filterCssFor(id: string | null | undefined): string {
  if (!id || id === "none") return "none";
  return filterCss(id);
}
