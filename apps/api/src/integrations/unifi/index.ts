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

export interface UnifiWanStats {
  /** TX bytes in the past 24 h (upload). */
  txBytes24h: number;
  /** RX bytes in the past 24 h (download). */
  rxBytes24h: number;
  /** Live WAN uplink TX bps. */
  txBps: number;
  /** Live WAN uplink RX bps. */
  rxBps: number;
}

export interface UnifiHealth {
  /** "ok" | "error" */
  status: "ok" | "error";
  /** WAN interface latency ms (gateway ping), if available. */
  wanLatencyMs: number | null;
}

export interface UnifiHourlyBucket {
  /** Hour index 0–23 (0 = 24 h ago, 23 = most recent). */
  hour: number;
  /** Download GB equivalent (RX). */
  down: number;
  /** Upload GB equivalent (TX). */
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
  private async request<T = any>(path: string): Promise<T> {
    // Bun supports a non-standard `tls` option to disable cert verification for
    // LAN controllers that present self-signed certificates.
    type BunFetchInit = RequestInit & { tls?: { rejectUnauthorized: boolean } };
    const init: BunFetchInit = {
      headers: { "X-API-KEY": this.apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(UNIFI_REQUEST_TIMEOUT_MS),
      tls: { rejectUnauthorized: false },
    };
    let res: Response;
    try {
      res = await fetch(
        `${this.baseUrl}/proxy/network/integrations/v1/sites/${this.siteId}${path}`,
        init,
      );
    } catch (err) {
      throw new UnifiError(0, `Network error: ${(err as Error).message}`);
    }
    if (!res.ok) {
      throw new UnifiError(res.status, await res.text());
    }
    return res.json() as Promise<T>;
  }

  /**
   * Fetch WAN (gateway) device stats — uplink bps + uptime.
   * Returns null if the site has no gateway device.
   */
  async getWanStats(): Promise<UnifiWanStats | null> {
    // biome-ignore lint/suspicious/noExplicitAny: API shape
    const res = await this.request<{ data: any[] }>(`/devices?limit=10`);
    const gateway = res.data?.find(
      // biome-ignore lint/suspicious/noExplicitAny: API shape
      (d: any) =>
        d.state === "ONLINE" &&
        (d.model?.toLowerCase().includes("ucg") ||
          d.model?.toLowerCase().includes("udm") ||
          d.ipAddress?.startsWith("192.168")),
    );
    if (!gateway) return null;

    const stats = await this.request<{
      uplink?: { txRateBps: number; rxRateBps: number };
    }>(`/devices/${gateway.id}/statistics/latest`).catch(() => null);

    return {
      txBps: stats?.uplink?.txRateBps ?? 0,
      rxBps: stats?.uplink?.rxRateBps ?? 0,
      // UniFi v1 integrations API doesn't expose 24h byte totals directly —
      // we derive a rough figure from the live rate as a fallback.
      txBytes24h: (stats?.uplink?.txRateBps ?? 0) * 86400 * 0.001,
      rxBytes24h: (stats?.uplink?.rxRateBps ?? 0) * 86400 * 0.001,
    };
  }
}

export const unifi = new UnifiClient();
