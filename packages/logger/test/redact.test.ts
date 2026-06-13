// Tests for @repo/logger: level resolution, redaction, and child binding.
// Run via: bun run test (vitest)
import pino, { type DestinationStream } from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import { createLogger, getLogger } from "../src/index.ts";

// Reset the module-level singleton to a known state before each test.
beforeEach(() => {
  createLogger({ service: "test", env: "test", pretty: false });
});

describe("createLogger, level resolution", () => {
  it("defaults to debug when pretty (dev)", () => {
    const log = createLogger({ service: "test-svc", env: "development", pretty: true });
    expect(log.level).toBe("debug");
  });

  it("defaults to info for JSON (the prod default)", () => {
    const log = createLogger({ service: "test-svc", env: "production", pretty: false });
    expect(log.level).toBe("info");
  });

  it("respects explicit level override", () => {
    const log = createLogger({
      service: "test-svc",
      env: "production",
      level: "warn",
      pretty: false,
    });
    expect(log.level).toBe("warn");
  });

  it("binds service and env on the base object", () => {
    // pino exposes bindings() on the logger instance.
    const log = createLogger({ service: "api", env: "test", pretty: false });
    const bindings = log.bindings();
    expect(bindings.service).toBe("api");
    expect(bindings.env).toBe("test");
  });
});

describe("getLogger", () => {
  it("returns the logger registered by createLogger", () => {
    const log = createLogger({ service: "test-svc", env: "test", pretty: false });
    expect(getLogger()).toBe(log);
  });

  it("reflects a subsequent createLogger call", () => {
    const first = createLogger({ service: "first", env: "test", pretty: false });
    const second = createLogger({ service: "second", env: "test", pretty: false });
    expect(getLogger()).toBe(second);
    // Keep first referenced so the unused-variable lint rule doesn't flag it.
    expect(first).not.toBe(second);
  });
});

describe("child logger binding", () => {
  it("child inherits parent bindings and adds its own", () => {
    const root = createLogger({ service: "worker", env: "test", pretty: false });
    const child = root.child({ worker: "light-enforcer" });
    const b = child.bindings();
    expect(b.service).toBe("worker");
    expect(b.worker).toBe("light-enforcer");
  });
});

// The REDACT_PATHS list from @repo/logger/src/index.ts, duplicated here to
// build a self-contained synchronous test logger. Both lists must stay in sync.
// Tests exercise the exact paths against the real secret and api object shapes.
const REDACT_PATHS = [
  "headers.authorization",
  "*.headers.authorization",
  "req.headers.authorization",
  "headers['x-api-key']",
  "*.headers['x-api-key']",
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
  "resolvedValue",
  "*.resolvedValue",
  "value",
  "*.value",
  "apiToken",
  "*.apiToken",
  "token",
  "*.token",
  "secret",
  "*.secret",
  "password",
  "*.password",
  "credential",
  "*.credential",
  "HOME_LAT",
  "*.HOME_LAT",
  "HOME_LON",
  "*.HOME_LON",
  "HOME_PLACE_NAME",
  "*.HOME_PLACE_NAME",
];

type LogLine = Record<string, unknown> & {
  msg?: string;
  status?: unknown;
  durationMs?: unknown;
  entityId?: unknown;
  reqId?: unknown;
  [key: string]: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function getFirstLogLine(lines: readonly LogLine[]): LogLine {
  if (lines.length === 0) {
    throw new Error("Expected at least one log line");
  }

  return lines[0];
}

// Builds a pino logger wired with the same redact config as @repo/logger and
// captures output synchronously via an in-memory write shim.
function buildTestLogger() {
  const lines: LogLine[] = [];
  const dest: DestinationStream = {
    write(chunk: string) {
      for (const line of chunk.split("\n")) {
        const trimmed = line.trim();
        if (trimmed) {
          try {
            const parsed = JSON.parse(trimmed);
            if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
              lines.push(parsed as LogLine);
            }
          } catch {
            // Not JSON.
          }
        }
      }
    },
  };

  const log = pino(
    {
      level: "trace",
      base: { service: "test", env: "test" },
      redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    },
    dest,
  );

  return { log, lines };
}

describe("redaction, named secret fields", () => {
  it("redacts HA_TOKEN at top level", () => {
    const { log, lines } = buildTestLogger();
    log.info({ HA_TOKEN: "super-secret-ha-token" }, "ha config");
    const entry = getFirstLogLine(lines);
    expect(entry.HA_TOKEN).toBe("[REDACTED]");
    expect(entry.msg).toBe("ha config");
  });

  it("redacts SPOTIFY_ACCESS_TOKEN at top level", () => {
    const { log, lines } = buildTestLogger();
    log.info({ SPOTIFY_ACCESS_TOKEN: "spotify-token-value" }, "spotify");
    const entry = getFirstLogLine(lines);
    expect(entry.SPOTIFY_ACCESS_TOKEN).toBe("[REDACTED]");
  });

  it("redacts DATABASE_URL at top level", () => {
    const { log, lines } = buildTestLogger();
    log.info({ DATABASE_URL: "postgres://user:pass@host:5432/db" }, "db config");
    const entry = getFirstLogLine(lines);
    expect(entry.DATABASE_URL).toBe("[REDACTED]");
  });

  it("redacts accessToken and refreshToken", () => {
    const { log, lines } = buildTestLogger();
    log.info({ accessToken: "acc-123", refreshToken: "ref-456" }, "tokens");
    const entry = getFirstLogLine(lines);
    expect(entry.accessToken).toBe("[REDACTED]");
    expect(entry.refreshToken).toBe("[REDACTED]");
  });

  it("redacts generic token/secret/password/credential keys", () => {
    const { log, lines } = buildTestLogger();
    log.info(
      { token: "tok", secret: "sek", password: "pw", credential: "cred" },
      "generic secrets",
    );
    const entry = getFirstLogLine(lines);
    expect(entry.token).toBe("[REDACTED]");
    expect(entry.secret).toBe("[REDACTED]");
    expect(entry.password).toBe("[REDACTED]");
    expect(entry.credential).toBe("[REDACTED]");
  });
});

describe("redaction, resolved-secret shapes", () => {
  // Asserts against resolved-secret object shapes:
  //   { name, resolvedValue }            (a resolved secret carrying cleartext)
  //   re-wrapped { dockerName, value }   (a re-wrapped resolved secret)

  it("redacts resolvedValue in a ResolvedSecret-shaped object", () => {
    const { log, lines } = buildTestLogger();
    // Logged as a nested object, the `resolvedValue` path covers this.
    log.info(
      { resolved: { name: "HA_TOKEN", resolvedValue: "actual-plaintext-token" } },
      "resolved secret",
    );
    const entry = getFirstLogLine(lines);
    const resolved = asRecord(entry.resolved);
    expect(resolved?.resolvedValue).toBe("[REDACTED]");
  });

  it("redacts the re-wrapped { dockerName, value } shape", () => {
    const { log, lines } = buildTestLogger();
    const rewrapped = { dockerName: "control-center_HA_TOKEN_abc123", value: "plaintext" };
    log.info({ rewrapped }, "rewrapped secret");
    const entry = getFirstLogLine(lines);
    const wrapped = asRecord(entry.rewrapped);
    expect(wrapped?.value).toBe("[REDACTED]");
  });
});

describe("redaction, auth headers", () => {
  it("redacts headers.authorization at top level", () => {
    const { log, lines } = buildTestLogger();
    log.info({ headers: { authorization: "Bearer super-secret" } }, "req");
    const entry = getFirstLogLine(lines);
    const headers = asRecord(entry.headers);
    expect(headers?.authorization).toBe("[REDACTED]");
  });

  it("redacts nested req.headers.authorization", () => {
    const { log, lines } = buildTestLogger();
    log.info({ req: { headers: { authorization: "Bearer xyz" } } }, "req log");
    const entry = getFirstLogLine(lines);
    const req = asRecord(entry.req);
    const reqHeaders = asRecord(req?.headers);
    expect(reqHeaders?.authorization).toBe("[REDACTED]");
  });
});

describe("redaction, home location fields", () => {
  it("redacts HOME_LAT, HOME_LON, HOME_PLACE_NAME", () => {
    const { log, lines } = buildTestLogger();
    log.info(
      { HOME_LAT: "34.0617", HOME_LON: "-118.2836", HOME_PLACE_NAME: "somewhere private" },
      "home location",
    );
    const entry = getFirstLogLine(lines);
    expect(entry.HOME_LAT).toBe("[REDACTED]");
    expect(entry.HOME_LON).toBe("[REDACTED]");
    expect(entry.HOME_PLACE_NAME).toBe("[REDACTED]");
  });
});

describe("safe fields are NOT redacted", () => {
  it("leaves non-sensitive fields intact", () => {
    const { log, lines } = buildTestLogger();
    log.info(
      {
        service: "api",
        env: "production",
        status: 200,
        durationMs: 42,
        entityId: "light.lamp_1",
        reqId: "req_abc123",
      },
      "request completed",
    );
    const entry = getFirstLogLine(lines);
    expect(entry.status).toBe(200);
    expect(entry.durationMs).toBe(42);
    expect(entry.entityId).toBe("light.lamp_1");
    expect(entry.reqId).toBe("req_abc123");
    expect(entry.msg).toBe("request completed");
  });
});
