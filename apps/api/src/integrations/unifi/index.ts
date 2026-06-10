import { z } from "zod";
import { env } from "../../env";

const UNIFI_REQUEST_TIMEOUT_MS = 5_000;

// Edge schemas: validate the envelope + the fields the Network tile consumes,
// while staying permissive (looseObject) about the many other attributes UniFi
// returns. Parsing at the boundary means domain code is fully typed with no
// `any` (www-355t.16).
const trafficBucketSchema = z.looseObject({
  "wan-rx_bytes": z.number().optional(),
  "wan-tx_bytes": z.number().optional(),
});
const trafficReportSchema = z.object({ data: z.array(trafficBucketSchema).optional() });

const healthEntrySchema = z.looseObject({
  subsystem: z.string().optional(),
  status: z.string().optional(),
  uptime_stats: z
    .looseObject({ WAN: z.looseObject({ latency_average: z.number().optional() }).optional() })
    .optional(),
});
const healthReportSchema = z.object({ data: z.array(healthEntrySchema).optional() });

// Active guest authorizations (GET stat/guest). Each row carries the device mac
// and the authorization window as epoch SECONDS (start/end). We stay permissive
// about the many other fields the controller returns (www-q002.10).
const guestEntrySchema = z.looseObject({
  mac: z.string().optional(),
  start: z.number().optional(),
  end: z.number().optional(),
});
const guestReportSchema = z.object({ data: z.array(guestEntrySchema).optional() });

/** @public — caught by the captive-portal service (www-q002.9) to map controller
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
 * @public — consumed by the captive-portal service (www-q002.9); declared here
 * with the client so the contract lives next to its sole implementation.
 */
export interface UnifiGuestClient {
  isConfigured(): boolean;
  /** Grant the device internet for `minutes` (default 43200 = 30 days). */
  authorizeGuest(mac: string, minutes?: number): Promise<void>;
  /** The controller's active authorization for `mac`, or null if none. */
  findActiveAuthorization(mac: string): Promise<UnifiGuestAuthorization | null>;
}

/** Controller wants the MAC lowercase, colon-separated. */
function normalizeMac(mac: string): string {
  return mac.trim().toLowerCase();
}

/**
 * Minimal UniFi Network API v1 client scoped to the data the Network tile
 * needs. Uses X-API-KEY header auth (UniFi OS 4+).
 */
export class UnifiClient implements UnifiGuestClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly siteId: string;

  constructor(opts?: { baseUrl?: string; apiKey?: string; siteId?: string }) {
    this.baseUrl = (opts?.baseUrl ?? env.UNIFI_CONTROLLER_URL).replace(/\/+$/, "");
    this.apiKey = opts?.apiKey ?? env.UNIFI_API_KEY;
    this.siteId = opts?.siteId ?? env.UNIFI_SITE_ID;
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  // Returns the raw parsed JSON; callers validate the shape with a Zod schema.
  private async legacyRequest(path: string, init?: RequestInit): Promise<unknown> {
    // Bun supports a non-standard `tls` option to disable cert verification for
    // LAN controllers that present self-signed certificates.
    type BunFetchInit = RequestInit & { tls?: { rejectUnauthorized: boolean } };
    const fetchInit: BunFetchInit = {
      ...init,
      headers: {
        "X-API-KEY": this.apiKey,
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(UNIFI_REQUEST_TIMEOUT_MS),
      tls: { rejectUnauthorized: false },
    };
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/proxy/network/api/s/${this.siteId}${path}`, fetchInit);
    } catch (err) {
      throw new UnifiError(0, `Network error: ${(err as Error).message}`);
    }
    if (!res.ok) {
      throw new UnifiError(res.status, await res.text());
    }
    return res.json();
  }

  /**
   * Fetch the last 2 hours of 5-minute WAN traffic buckets.
   * Always returns exactly 24 buckets; leading gaps are zero-filled.
   */
  async getTrafficBuckets(): Promise<UnifiTrafficBucket[]> {
    const now = Date.now();
    const start = now - 2 * 60 * 60 * 1000;
    const raw = await this.legacyRequest("/stat/report/5minutes.site", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attrs: ["wan-rx_bytes", "wan-tx_bytes", "time"], start, end: now }),
    });
    const { data } = trafficReportSchema.parse(raw);
    const buckets: UnifiTrafficBucket[] = (data ?? [])
      .map((b) => ({ down: b["wan-rx_bytes"] ?? 0, up: b["wan-tx_bytes"] ?? 0 }))
      .slice(-24);
    // Prepend zero-fill so the chart always has 24 bars
    while (buckets.length < 24) {
      buckets.unshift({ down: 0, up: 0 });
    }
    return buckets;
  }

  /**
   * Fetch WAN health: online/offline status and measured internet latency.
   */
  async getWanHealth(): Promise<UnifiHealth> {
    const raw = await this.legacyRequest("/stat/health");
    const { data } = healthReportSchema.parse(raw);
    const wan = (data ?? []).find((s) => s.subsystem === "wan");
    if (!wan) return { status: UnifiStatus.Error, wanLatencyMs: null };
    return {
      status: wan.status === UnifiStatus.Ok ? UnifiStatus.Ok : UnifiStatus.Error,
      wanLatencyMs: wan.uptime_stats?.WAN?.latency_average ?? null,
    };
  }

  /**
   * Grant a device internet access via the guest manager. POST cmd/stamgr with
   * cmd=authorize-guest. `minutes` defaults to 43200 (30 days, the portal's
   * authorization lifetime). Idempotent on the controller — re-authorizing an
   * already-authorized device just refreshes the window. Throws UnifiError on
   * any controller failure (services throw; never fake a grant — www-q002.10).
   */
  async authorizeGuest(mac: string, minutes = 43200): Promise<void> {
    await this.legacyRequest("/cmd/stamgr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd: "authorize-guest", mac: normalizeMac(mac), minutes }),
    });
  }

  /**
   * Look up the controller's active authorization for a device (GET stat/guest).
   * Used to cross-check that the controller still holds a grant the DB believes
   * is active, and to heal it if the controller lost it (e.g. after a reboot).
   * Returns null when no authorization exists for the mac. Throws UnifiError
   * when the controller is unreachable.
   */
  async findActiveAuthorization(mac: string): Promise<UnifiGuestAuthorization | null> {
    const target = normalizeMac(mac);
    const raw = await this.legacyRequest("/stat/guest");
    const { data } = guestReportSchema.parse(raw);
    const row = (data ?? []).find((g) => g.mac?.toLowerCase() === target);
    if (!row?.mac) return null;
    return {
      mac: row.mac.toLowerCase(),
      start: row.start ?? null,
      end: row.end ?? null,
    };
  }
}

export const unifi = new UnifiClient();
