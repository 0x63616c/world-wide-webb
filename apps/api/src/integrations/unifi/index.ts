import { env } from "../../env";

const UNIFI_REQUEST_TIMEOUT_MS = 5_000;

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

/**
 * Minimal UniFi Network API v1 client scoped to the data the Network tile
 * needs. Uses X-API-KEY header auth (UniFi OS 4+).
 */
export class UnifiClient {
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

  // biome-ignore lint/suspicious/noExplicitAny: intentional generic fetch helper
  private async legacyRequest<T = any>(path: string, init?: RequestInit): Promise<T> {
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
    return res.json() as Promise<T>;
  }

  /**
   * Fetch the last 2 hours of 5-minute WAN traffic buckets.
   * Always returns exactly 24 buckets; leading gaps are zero-filled.
   */
  async getTrafficBuckets(): Promise<UnifiTrafficBucket[]> {
    const now = Date.now();
    const start = now - 2 * 60 * 60 * 1000;
    // biome-ignore lint/suspicious/noExplicitAny: API response shape
    const res = await this.legacyRequest<{ data: any[] }>("/stat/report/5minutes.site", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attrs: ["wan-rx_bytes", "wan-tx_bytes", "time"], start, end: now }),
    });
    const buckets: UnifiTrafficBucket[] = (res.data ?? [])
      // biome-ignore lint/suspicious/noExplicitAny: API response shape
      .map((b: any) => ({ down: b["wan-rx_bytes"] ?? 0, up: b["wan-tx_bytes"] ?? 0 }))
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
    // biome-ignore lint/suspicious/noExplicitAny: API response shape
    const res = await this.legacyRequest<{ data: any[] }>("/stat/health");
    // biome-ignore lint/suspicious/noExplicitAny: API response shape
    const wan = (res.data ?? []).find((s: any) => s.subsystem === "wan");
    if (!wan) return { status: UnifiStatus.Error, wanLatencyMs: null };
    return {
      status: wan.status === UnifiStatus.Ok ? UnifiStatus.Ok : UnifiStatus.Error,
      wanLatencyMs: wan.uptime_stats?.WAN?.latency_average ?? null,
    };
  }
}

export const unifi = new UnifiClient();
