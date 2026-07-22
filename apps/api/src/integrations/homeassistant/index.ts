import { getLogger } from "@www/logger";
import { z } from "zod";
import { env } from "../../env";
import { type HaEntity, HaError, haEntitySchema } from "./types";

const HA_REQUEST_TIMEOUT_MS = 5_000;

/**
 * Typed REST client for Home Assistant. Single shared singleton (`ha`).
 *
 * Every request carries a 5s timeout and the bearer `HA_TOKEN`. When the token
 * is empty (`isConfigured()` is false) the api still boots; callers should check
 * `ha.isConfigured()` and degrade to placeholder data rather than firing
 * requests that will 401.
 */
export class HomeAssistantClient {
  private readonly baseUrl = env.HA_URL;
  private readonly token = env.HA_TOKEN;

  /** True only when an HA_TOKEN is present. */
  isConfigured(): boolean {
    return this.token.length > 0;
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };
  }

  /**
   * Single request choke point for every HA call. Owns the timeout, the network
   * vs non-2xx error mapping to `HaError`, and the `warn` telemetry, then returns
   * the raw `Response` so callers pick the body shape (json / text / binary).
   *
   * `init` must carry its own headers (auth differs per caller); `logPath`
   * overrides what is logged as `haPath` (used to strip an access token from a
   * media path before it reaches the logs).
   */
  private async haFetch(
    path: string,
    init: RequestInit,
    logPath: string = path,
  ): Promise<Response> {
    const startedAt = performance.now();
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(HA_REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const durationMs = +(performance.now() - startedAt).toFixed(1);
      // status 0 = network-level failure (timeout, DNS, refused)
      getLogger().warn({ haPath: logPath, haStatus: 0, durationMs }, "ha request failed");
      throw new HaError(0, `Network error: ${(err as Error).message}`);
    }
    if (!res.ok) {
      const durationMs = +(performance.now() - startedAt).toFixed(1);
      getLogger().warn({ haPath: logPath, haStatus: res.status, durationMs }, "ha request non-2xx");
      throw new HaError(res.status, await res.text());
    }
    return res;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.haFetch(path, {
      ...init,
      headers: { ...this.authHeaders(), ...(init?.headers ?? {}) },
    });
    return res.json() as Promise<T>;
  }

  /** All entities in a domain (e.g. "light", "climate"). */
  async getEntities(domain: string): Promise<HaEntity[]> {
    const all = z.array(haEntitySchema).parse(await this.request<unknown>("/api/states"));
    return all.filter((e) => e.entity_id.startsWith(`${domain}.`));
  }

  /** A single entity by id (e.g. "light.living_room"). */
  async getEntity(entityId: string): Promise<HaEntity> {
    return haEntitySchema.parse(await this.request<unknown>(`/api/states/${entityId}`));
  }

  /** Call a service (e.g. callService("light", "turn_on", { entity_id })). */
  async callService(
    domain: string,
    service: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    await this.request(`/api/services/${domain}/${service}`, {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  /** Render a Jinja2 template against HA state; returns the rendered string. */
  async renderTemplate(template: string): Promise<string> {
    const res = await this.haFetch("/api/template", {
      method: "POST",
      headers: this.authHeaders(),
      body: JSON.stringify({ template }),
    });
    return res.text();
  }

  /** Authenticated camera snapshot proxy URL for an entity. */
  cameraProxyUrl(entityId: string): string {
    return `${this.baseUrl}/api/camera_proxy/${entityId}`;
  }

  /**
   * Raw authenticated GET for binary HA resources (entity_picture artwork).
   * Returns the Response so callers can stream body + content-type through.
   */
  async getMedia(path: string): Promise<Response> {
    // entity_picture paths embed an HA access token in the query string ,
    // log only the bare path so the token never reaches the logs.
    const logPath = path.split("?")[0] ?? path;
    return this.haFetch(path, { headers: { Authorization: `Bearer ${this.token}` } }, logPath);
  }
}

export const ha = new HomeAssistantClient();
