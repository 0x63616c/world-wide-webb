import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { envSchema, hydrateSecretFiles } from "../env";

// Smoke test: the api must boot with no secrets configured (graceful
// degradation). Verifies the env schema applies its safe defaults.
test("env schema parses with empty environment", () => {
  const env = envSchema.parse({});
  expect(env.PORT).toBe(4201);
  expect(env.HA_TOKEN).toBe("");
  expect(env.HA_URL).toBe("http://homeassistant.local:8123");
  expect(env.DATABASE_URL).toBe("postgresql://cc:cc@localhost:5432/controlcenter");
  expect(env.HOME_LAT).toBe(34.0537);
  expect(env.HOME_LON).toBe(-118.2428);
  expect(env.HOME_PLACE_NAME).toBe("Home");
  expect(env.HOME_RADIUS_MILES).toBe(1);
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

// Spotify Web API creds must default to "" so the api boots without them
// (the SpotifyClient checks isConfigured() before making any call).
test("Spotify creds default to empty string", () => {
  const env = envSchema.parse({});
  expect(env.SPOTIFY_CLIENT_ID).toBe("");
  expect(env.SPOTIFY_CLIENT_SECRET).toBe("");
  expect(env.SPOTIFY_REFRESH_TOKEN).toBe("");
});

// Spotify creds arrive as docker secret files in the Swarm (same rail as
// HA_TOKEN, WIFI_SSID, etc.) so hydrateSecretFiles must include them.
test("hydrates Spotify creds from mounted docker secret files", () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-spotify-"));
  writeFileSync(join(dir, "SPOTIFY_CLIENT_ID"), "test-client-id\n");
  writeFileSync(join(dir, "SPOTIFY_CLIENT_SECRET"), "test-client-secret\n");
  writeFileSync(join(dir, "SPOTIFY_REFRESH_TOKEN"), "test-refresh-token\n");
  const src: Record<string, string | undefined> = {};
  hydrateSecretFiles(src, dir);
  expect(src.SPOTIFY_CLIENT_ID).toBe("test-client-id");
  expect(src.SPOTIFY_CLIENT_SECRET).toBe("test-client-secret");
  expect(src.SPOTIFY_REFRESH_TOKEN).toBe("test-refresh-token");
});
