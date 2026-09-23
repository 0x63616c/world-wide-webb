/**
 * THE env manifest — every environment key the whole system reads, declared
 * exactly once (design spec §4, goal 2 & 4). Feature configs become typed
 * projections of this via `ENV.pick(...)`; nothing re-declares a key or its
 * default. Answers "what does prod need?" in one file.
 *
 * Requiredness tiers:
 * - `.required()`            — must be present in prod; `assertEnv` crashes if
 *                             missing. No prod default (may carry `.devDefault`
 *                             for local dev only).
 * - `.optionalSecret()`     — a secret with no default; resolves to `undefined`
 *                             at runtime when unset, but keeps its static type
 *                             `string` so gate-guarded consumers typecheck.
 * - `.default(v)`           — safe, public, non-secret default; same everywhere.
 * - `.optional()`           — may be absent anywhere → `undefined`.
 *
 * Hydration inputs (POSTGRES_PASSWORD*, POSTGRES_HOST/PORT/USER/DB) are NOT keys
 * here — they feed `databaseUrlFromSecret()` in hydrate.ts to derive
 * DATABASE_URL (design spec §4 "Hydration inputs").
 */
import { DEFAULT_METRICS_PORT } from "../metrics/port";
import { enumOf, int, num, pgUrl, secret, str, url } from "./fields";
import { defineEnv } from "./registry";

export const ENV = defineEnv({
  // ── Infra / process ──────────────────────────────────────────────────────
  NODE_ENV: enumOf("development", "production", "test").default("development"),
  PORT: int().default(4201).forRuntime("api"),
  BUILD_HASH: str().default("dev"),
  // Prometheus exposition listener (#214). A DEDICATED port on every backend
  // runtime, never a route on the service's own port: the api's :4201 is mapped
  // through the Cloudflare tunnel, so /metrics there would be public. 9464 is
  // the conventional Prometheus-exporter port. No `.forRuntime()` — api and
  // worker both serve it, and the default is always right
  // in-cluster (nothing else in a pod binds it), so it is never set in prod.
  METRICS_PORT: int().default(DEFAULT_METRICS_PORT),

  // ── Database (features + core) ────────────────────────────────────────────
  DATABASE_URL: pgUrl().required().devDefault("postgresql://cc:cc@localhost:5432/controlcenter"),

  // ── Home Assistant (ac, ctrl) ─────────────────────────────────────────────
  HA_URL: url().default("http://homeassistant.local:8123"),
  HA_TOKEN: secret().required().forRuntime("api", "worker").forFeatures("ac", "ctrl"),
  CLIMATE_ENTITY_ID: str().default("climate.home").forRuntime("api").forFeatures("ac"),

  // ── Home location (weather) ───────────────────────────────────────────────
  HOME_LAT: num().required().devDefault(34.0537).forRuntime("api", "worker").forFeatures("weather"),
  HOME_LON: num()
    .required()
    .devDefault(-118.2428)
    .forRuntime("api", "worker")
    .forFeatures("weather"),

  // ── Guest Wi-Fi (wifi) ────────────────────────────────────────────────────
  // Feed the board's Wi-Fi QR tile and nothing else: never rendered as text.
  // Empty in local dev unless the vault carries them (tilt/load-secrets.sh);
  // while empty the tile renders its "not configured" face instead of a code.
  WIFI_GUEST_SSID: secret().required().devDefault("").forRuntime("api").forFeatures("wifi"),
  WIFI_GUEST_PASSWORD: secret().required().devDefault("").forRuntime("api").forFeatures("wifi"),

  // ── Media storage (booth, wakes) ──────────────────────────────────────────
  MEDIA_STORAGE_DIR: str().default("/mnt/media").forRuntime("api").forFeatures("booth", "wakes"),
});
