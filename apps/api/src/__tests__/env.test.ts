import { expect, test } from "vitest";
import { envSchema } from "../env";

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

// Spotify Web API creds must default to "" so the api boots without them
// (the SpotifyClient checks isConfigured() before making any call).
test("Spotify creds default to empty string", () => {
  const env = envSchema.parse({});
  expect(env.SPOTIFY_CLIENT_ID).toBe("");
  expect(env.SPOTIFY_CLIENT_SECRET).toBe("");
  expect(env.SPOTIFY_REFRESH_TOKEN).toBe("");
});
