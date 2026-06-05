/**
 * Public home defaults for the web client (www-mqp).
 *
 * The real home coordinates and address are NOT baked into this open-source
 * repo. These are a deliberately PUBLIC placeholder (LA City Hall, city-level
 * label) used only as a map fallback center when the car's live location is
 * unavailable, and as a cosmetic greeting label. The api delivers the real
 * place name (sourced from 1Password) on the Tesla payload, so the map pill
 * shows the true location in prod without it ever living in source.
 *
 * Single source of truth: previously these coords were triplicated across
 * TeslaMap + two Tesla modals (with a "Duplicated here" comment). Import from
 * here instead of re-declaring.
 */

/** [lng, lat] — maplibre order. LA City Hall (public placeholder). */
export const HOME_CENTER: [number, number] = [-118.2428, 34.0537];

/** Latitude of the public placeholder home center. */
export const HOME_LAT = 34.0537;

/** Longitude of the public placeholder home center. */
export const HOME_LON = -118.2428;

/** City-level label shown on the clock greeting. Not an address. */
export const HOME_LABEL = "Los Angeles";
