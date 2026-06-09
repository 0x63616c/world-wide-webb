// All process.env reads for the logger (LOG_LEVEL, NODE_ENV) live HERE and
// nowhere else — call sites never read env directly. See docs/logging.md §3.
import pino, { type Logger as PinoLogger } from "pino";

/** @public — re-exported Logger type for service call sites */
export type Logger = PinoLogger;

export type CreateLoggerOptions = {
  /** Service name bound on every line, e.g. "api" | "worker" | "media-worker" | "bosun". */
  service: string;
  /** Environment string, bound on every line. Defaults to NODE_ENV ?? "development". */
  env?: string;
  /** Explicit level override. Defaults to LOG_LEVEL env, else "info" (prod) / "debug" (dev). */
  level?: string;
  /**
   * Force pretty (true) or JSON (false) output instead of inferring from env.
   * Useful in tests and for the bosun deploy agent (which must emit JSON in prod
   * even if NODE_ENV is not set — see docs/logging.md §3).
   */
  pretty?: boolean;
};

// Paths whose values are replaced with "[REDACTED]" if they ever appear in a
// logged object. Defence-in-depth behind the primary discipline rule of never
// passing secret values to the logger at all. See docs/logging.md §4.
const REDACT_PATHS = [
  // Auth headers anywhere in a logged object (top-level + nested .headers)
  "headers.authorization",
  "*.headers.authorization",
  "req.headers.authorization",
  "headers['x-api-key']",
  "*.headers['x-api-key']",
  // Named secret fields if a config/env object is ever logged
  "HA_TOKEN",
  "*.HA_TOKEN",
  "UNIFI_API_KEY",
  "*.UNIFI_API_KEY",
  "WIFI_PASSWORD",
  "*.WIFI_PASSWORD",
  "SPOTIFY_CLIENT_SECRET",
  "*.SPOTIFY_CLIENT_SECRET",
  "SPOTIFY_REFRESH_TOKEN",
  "*.SPOTIFY_REFRESH_TOKEN",
  "SPOTIFY_ACCESS_TOKEN",
  "*.SPOTIFY_ACCESS_TOKEN",
  "accessToken",
  "*.accessToken",
  "refreshToken",
  "*.refreshToken",
  "OPENROUTER_API_KEY",
  "*.OPENROUTER_API_KEY",
  "DATABASE_URL",
  "*.DATABASE_URL",
  "POSTGRES_PASSWORD",
  "*.POSTGRES_PASSWORD",
  "BOSUN_WEBHOOK_TOKEN",
  "*.BOSUN_WEBHOOK_TOKEN",
  "OP_SERVICE_ACCOUNT_TOKEN",
  "*.OP_SERVICE_ACCOUNT_TOKEN",
  "GHCR_PULL_TOKEN",
  "*.GHCR_PULL_TOKEN",
  // bosun ResolvedSecret carries `resolvedValue`; reconcile/secrets.ts re-wraps
  // it as `{ dockerName, value }` — both keys must be censored.
  "resolvedValue",
  "*.resolvedValue",
  "value",
  "*.value",
  "apiToken",
  "*.apiToken", // Cloudflare token
  // Generic wrapper-key catch-all — brittle-insurance behind layer-1 discipline.
  "token",
  "*.token",
  "secret",
  "*.secret",
  "password",
  "*.password",
  "credential",
  "*.credential",
  // Private home location (no-home-address guard territory)
  "HOME_LAT",
  "*.HOME_LAT",
  "HOME_LON",
  "*.HOME_LON",
  "HOME_PLACE_NAME",
  "*.HOME_PLACE_NAME",
];

// Process-wide root logger — set by createLogger(), read by getLogger().
// Module-global is intentional and the ONLY exception to the "no module-global
// mutable state" rule: this singleton is the entire purpose of this module.
let _root: Logger | null = null;

/**
 * Build the ROOT logger for a process. Call EXACTLY ONCE per service at
 * startup and pass the instance down (or access via getLogger). Binds
 * { service, env } on every line, installs redaction, and selects
 * pino-pretty (non-prod) vs raw JSON (prod).
 */
export function createLogger(opts: CreateLoggerOptions): Logger {
  const env = opts.env ?? process.env.NODE_ENV ?? "development";
  const isProd = env === "production";

  // Level: explicit opt > LOG_LEVEL env > "debug" in dev, "info" in prod.
  const level = opts.level ?? process.env.LOG_LEVEL ?? (isProd ? "info" : "debug");

  // Pretty: explicit opt wins; otherwise infer from env.
  const usePretty = opts.pretty !== undefined ? opts.pretty : !isProd;

  const baseOptions: pino.LoggerOptions = {
    level,
    base: { service: opts.service, env },
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
  };

  const logger = usePretty
    ? pino(baseOptions, pino.transport({ target: "pino-pretty", options: { translateTime: true } }))
    : pino(baseOptions);

  _root = logger;
  return logger;
}

/**
 * Process-wide accessor. createLogger() registers the root; getLogger()
 * returns it. Throws if called before createLogger — a hard signal that a
 * module logged before the process initialised its logger (no silent
 * default root). Used by shared @repo/api domain services that run under
 * multiple process roots (api + media-worker). See docs/logging.md §2.
 */
export function getLogger(): Logger {
  if (_root === null) {
    throw new Error(
      "@repo/logger: getLogger() called before createLogger(). " +
        "Call createLogger({ service }) once at process startup.",
    );
  }
  return _root;
}
