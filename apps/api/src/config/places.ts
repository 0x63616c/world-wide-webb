/**
 * Named places for the Tesla map pill (www-6gx).
 *
 * When the car's GPS falls within `radiusMiles` of a place, the map pill shows
 * that place's name instead of the raw Home Assistant zone. Coordinates are not
 * secrets, so this is declared in source — NOT an env var.
 *
 * Order is priority: the FIRST place whose radius contains the point wins, so
 * list smaller/more-specific places before broader ones that might overlap.
 */

export interface NamedPlace {
  /** Human label shown on the map pill. */
  name: string;
  lat: number;
  lon: number;
  /** Match radius in miles — point is "at" the place when within this distance. */
  radiusMiles: number;
}

export const PLACES: readonly NamedPlace[] = [
  { name: "Home", lat: 34.0537, lon: -118.2428, radiusMiles: 1 },
];

// Mean Earth radius in miles, for the haversine great-circle distance.
const EARTH_RADIUS_MILES = 3958.8;

/** Great-circle distance in miles between two lat/lon points (haversine). */
export function haversineMiles(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h));
}

/**
 * First named place whose radius contains the point, or undefined if none match.
 * List order is the tie-break (priority), matching the declared-config pattern
 * used by config/lights.ts.
 */
export function findPlace(lat: number, lon: number): NamedPlace | undefined {
  return PLACES.find((p) => haversineMiles(lat, lon, p.lat, p.lon) <= p.radiusMiles);
}
