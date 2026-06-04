import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { databaseUrlFromSecret, envSchema, hydrateSecretFiles } from "../env";

// Smoke test: the api must boot with no secrets configured (graceful
// degradation). Verifies the env schema applies its safe defaults.
test("env schema parses with empty environment", () => {
  const env = envSchema.parse({});
  expect(env.PORT).toBe(4201);
  expect(env.HA_TOKEN).toBe("");
  expect(env.HA_URL).toBe("http://homeassistant.local:8123");
  expect(env.DATABASE_URL).toBe("postgresql://cc:cc@localhost:5432/controlcenter");
  expect(env.LAT).toBe(34.0537);
  expect(env.LON).toBe(-118.2428);
});

// In the Swarm the Postgres password is a mounted docker secret file, not an
// env var. databaseUrlFromSecret() builds DATABASE_URL from it so the password
// never lands in the service spec. The resolver takes an explicit env map so
// the test never touches process.env.
test("builds DATABASE_URL from a mounted POSTGRES_PASSWORD secret file", () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-secret-"));
  const file = join(dir, "POSTGRES_PASSWORD");
  writeFileSync(file, "s3cr3t/p@ss\n");
  // Password is URL-encoded; host/db/user fall back to swarm defaults.
  expect(databaseUrlFromSecret({ POSTGRES_PASSWORD_FILE: file })).toBe(
    "postgresql://postgres:s3cr3t%2Fp%40ss@postgres:5432/control_center",
  );
});

test("explicit DATABASE_URL wins over the secret file", () => {
  expect(
    databaseUrlFromSecret({
      DATABASE_URL: "postgresql://cc:cc@localhost:5432/controlcenter",
      POSTGRES_PASSWORD_FILE: "/nonexistent",
    }),
  ).toBe("postgresql://cc:cc@localhost:5432/controlcenter");
});

test("returns undefined when no secret file is mounted (dev/test)", () => {
  expect(databaseUrlFromSecret({ POSTGRES_PASSWORD_FILE: "/nonexistent/POSTGRES_PASSWORD" })).toBe(
    undefined,
  );
});

// hydrateSecretFiles maps mounted docker secret files to env. Without it the
// bundled production api (no entrypoint shell) sees empty HA_TOKEN etc. and
// reports "not configured".
test("hydrates secret-backed env from mounted docker secret files", () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-secrets-"));
  writeFileSync(join(dir, "HA_TOKEN"), "ha-token-value\n");
  writeFileSync(join(dir, "WIFI_SSID"), "world-wide-webb\n");
  const src: Record<string, string | undefined> = { HA_TOKEN: "explicit-wins" };
  hydrateSecretFiles(src, dir);
  expect(src.HA_TOKEN).toBe("explicit-wins"); // existing env value is not overwritten
  expect(src.WIFI_SSID).toBe("world-wide-webb"); // loaded from file
  expect(src.UNIFI_API_KEY).toBeUndefined(); // no file, stays unset
});
