/**
 * World-clock zones for the Clock tile's WorldClocks detail modal.
 *
 * This is CONFIGURATION (which cities to show + their IANA timezones), not live
 * data — the actual times are computed client-side from the real wall clock via
 * Intl.DateTimeFormat. Home is Los Angeles.
 */

export interface WorldClockZone {
  city: string;
  /** IANA timezone, e.g. "America/New_York". */
  tz: string;
  home?: boolean;
}

export const WORLD_CLOCK_ZONES: WorldClockZone[] = [
  { city: "Los Angeles", tz: "America/Los_Angeles", home: true },
  { city: "New York", tz: "America/New_York" },
  { city: "London", tz: "Europe/London" },
  { city: "Tokyo", tz: "Asia/Tokyo" },
  { city: "Sydney", tz: "Australia/Sydney" },
];
