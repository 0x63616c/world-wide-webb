// All process.env reads for the logger (LOG_LEVEL, LOG_PRETTY, APP_ENV) live
// HERE and nowhere else, call sites never read env directly. See docs/logging.md §3.
//
// NOTE: we deliberately do NOT key behaviour on process.env.NODE_ENV. The api,
// worker and media-worker ship as bun single-file bundles, and bun INLINES
// process.env.NODE_ENV to a build-time literal, so a NODE_ENV check is frozen
// at build and ignores the container's runtime env (it crash-looped prod once,
// www-rw07). LOG_PRETTY / APP_ENV / LOG_LEVEL are read live at runtime instead.
import pino, { type Logger as PinoLogger } from "pino";
// pino-pretty imported as a SYNCHRONOUS stream factory (not a pino.transport
// target): transports spawn a thread-stream worker that re-resolves "pino-pretty"
// from a file path which does not exist inside a single-file bundle. A sync
// stream is bundled inline and works everywhere.
import prettyStream from "pino-pretty";

/** @public, re-exported Logger type for service call sites */
export type Logger = PinoLogger;

export type CreateLoggerOptions = {
  /** Service name bound on every line, e.g. "api" | "worker" | "media-worker". */
  service: string;
  /** Environment string, bound on every line. Defaults to APP_ENV ?? "development". */
  env?: string;
  /** Explicit level override. Defaults to LOG_LEVEL env, else "debug" (pretty) / "info" (JSON). */
  level?: string;
  /**
   * Force pretty (true) or JSON (false) output. When omitted, defaults to JSON
   * and opts into pretty only when LOG_PRETTY=1/true (local dev). Useful in tests
   * (which pass false). See docs/logging.md §3.
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
  "OP_SERVICE_ACCOUNT_TOKEN",
  "*.OP_SERVICE_ACCOUNT_TOKEN",
  "GHCR_PULL_TOKEN",
  "*.GHCR_PULL_TOKEN",
  // Resolved-secret shapes carry the cleartext under `resolvedValue` or a
  // re-wrapped `{ dockerName, value }`, both keys must be censored.
  "resolvedValue",
  "*.resolvedValue",
  "value",
  "*.value",
  "apiToken",
  "*.apiToken", // Cloudflare token
  // Generic wrapper-key catch-all, brittle-insurance behind layer-1 discipline.
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

// Process-wide root logger, set by createLogger(), read by getLogger().
// Module-global is intentional and the ONLY exception to the "no module-global
// mutable state" rule: this singleton is the entire purpose of this module.
let _root: Logger | null = null;

/**
 * Build the ROOT logger for a process. Call EXACTLY ONCE per service at
 * startup and pass the instance down (or access via getLogger). Binds
 * { service, env } on every line, installs redaction, and selects raw JSON
 * (default) vs pino-pretty (LOG_PRETTY=1, via a bundle-safe sync stream).
 */
export function createLogger(opts: CreateLoggerOptions): Logger {
  // Bound env LABEL. APP_ENV is read live (NODE_ENV is baked into bundles, so it
  // would mislabel prod as "development"); default to "development" locally.
  const env = opts.env ?? process.env.APP_ENV ?? "development";

  // Pretty vs JSON. Default is JSON, the bundle-safe, prod-correct path. Opt
  // INTO pretty with LOG_PRETTY=1 (local dev / tilt), never via NODE_ENV.
  const usePretty =
    opts.pretty !== undefined
      ? opts.pretty
      : process.env.LOG_PRETTY === "1" || process.env.LOG_PRETTY === "true";

  // Level: explicit opt > LOG_LEVEL env > "debug" when pretty (dev), else "info".
  const level = opts.level ?? process.env.LOG_LEVEL ?? (usePretty ? "debug" : "info");

  const baseOptions: pino.LoggerOptions = {
    level,
    base: { service: opts.service, env },
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
  };

  // Sync pino-pretty stream (NOT pino.transport) so bundled services never spawn
  // a thread-stream worker that can't resolve in a single-file bundle. www-rw07.
  const logger = usePretty
    ? pino(baseOptions, prettyStream({ translateTime: true }))
    : pino(baseOptions);

  _root = logger;
  return logger;
}

/**
 * Process-wide accessor. createLogger() registers the root; getLogger()
 * returns it. Throws if called before createLogger, a hard signal that a
 * module logged before the process initialised its logger (no silent
 * default root). Used by shared @control-center/api domain services that run under
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
