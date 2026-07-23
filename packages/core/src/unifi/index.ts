/** @public , caught by the captive-portal service (www-q002.9) to map controller
 * outages onto the GenericError path; no internal consumer in this ticket yet. */
export class UnifiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "UnifiError";
  }
}

export const UnifiStatus = {
  Ok: "ok",
  Error: "error",
} as const;
export type UnifiStatus = (typeof UnifiStatus)[keyof typeof UnifiStatus];

export interface UnifiHealth {
  status: UnifiStatus;
  /** WAN interface latency ms (gateway ping), if available. */
  wanLatencyMs: number | null;
}

export interface UnifiTrafficBucket {
  /** Download bytes for this 5-minute window. */
  down: number;
  /** Upload bytes for this 5-minute window. */
  up: number;
}

/** One active guest authorization as reported by the controller (stat/guest). */
export interface UnifiGuestAuthorization {
  /** Device MAC, lowercase colon-separated. */
  mac: string;
  /** Authorization window start (epoch seconds), if reported. */
  start: number | null;
  /** Authorization window end (epoch seconds), if reported. */
  end: number | null;
}

/**
 * The guest-authorization surface the captive portal depends on. The portal
 * service takes this interface (not the concrete client) so tests inject a
 * mock and assert no real network call escapes (www-q002.10). `UnifiClient`
 * implements it; the only writes in the system are authorizeGuest.
 *
 * @public , consumed by the captive-portal service (www-q002.9); declared here
 * with the client so the contract lives next to its sole implementation.
 */
export interface UnifiGuestClient {
  isConfigured(): boolean;
  /** Grant the device internet for `minutes` (default 43200 = 30 days). */
  authorizeGuest(mac: string, minutes?: number): Promise<void>;
  /** The controller's active authorization for `mac`, or null if none. */
  findActiveAuthorization(mac: string): Promise<UnifiGuestAuthorization | null>;
}

/**
 * The traffic/health read surface the Network tile depends on. Split from
 * `UnifiGuestClient` so consumers can depend on only the slice they use;
 * `UnifiClient` implements both.
 */
export interface UnifiStatsClient {
  isConfigured(): boolean;
  /** Last 2 hours of WAN traffic as 24 five-minute buckets. */
  getTrafficBuckets(): Promise<UnifiTrafficBucket[]>;
  /** WAN online/offline status and measured internet latency. */
  getWanHealth(): Promise<UnifiHealth>;
}

export { createUnifiClient, UnifiClient } from "./client";
