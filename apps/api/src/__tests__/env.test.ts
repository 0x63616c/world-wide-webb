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
  expect(env.LAT).toBe(34.0537);
  expect(env.LON).toBe(-118.2428);
  expect(env.LOCATION_LABEL).toBe("Home");
});
