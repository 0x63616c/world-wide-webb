import { describe, expect, it } from "vitest";
import deploySpec from "../../../../deploy.config.ts";
import { envSchema } from "../env";

// Contract test: every env var the deploy manifest sets on the api service (and
// every secret it delivers) must be a key the app actually reads via envSchema.
// A drifted key is silently ignored at runtime and the app falls back to its
// default — exactly the UNIFI_URL vs UNIFI_CONTROLLER_URL bug this guards (CC-355t.7).

const schemaKeys = new Set(Object.keys(envSchema.shape));

// Keys set on the container but NOT parsed by envSchema, by design:
//  - TZ: read by the OS/Node runtime, not the app schema.
//  - APP_ENV: read by @repo/logger (the structured-logging env label), not the
//    app schema. NODE_ENV can't carry it because bun bakes NODE_ENV into the
//    bundle at build time. CC-rw07.
const ENV_ALLOWLIST = new Set(["TZ", "APP_ENV"]);
//  - POSTGRES_PASSWORD: consumed as a mounted secret FILE to build DATABASE_URL
//    (env.ts databaseUrlFromSecret), never parsed as a schema field.
const SECRET_ALLOWLIST = new Set(["POSTGRES_PASSWORD"]);

const api = deploySpec.services.find((s) => s.name === "api");

describe("deploy.config.ts api env contract (CC-355t.7)", () => {
  it("the api service exists in the manifest", () => {
    expect(api).toBeDefined();
  });

  it("every api env key is read by envSchema (or explicitly allowlisted)", () => {
    const unknown = Object.keys(api?.env ?? {}).filter(
      (k) => !schemaKeys.has(k) && !ENV_ALLOWLIST.has(k),
    );
    expect(unknown).toEqual([]);
  });

  it("every api secret name is read by envSchema (or explicitly allowlisted)", () => {
    const unknown = (api?.secrets ?? [])
      .map((s) => s.name)
      .filter((name) => !schemaKeys.has(name) && !SECRET_ALLOWLIST.has(name));
    expect(unknown).toEqual([]);
  });

  it("delivers the UniFi controller URL under the key env.ts reads", () => {
    expect(api?.env.UNIFI_CONTROLLER_URL).toBeTruthy();
    expect(api?.env).not.toHaveProperty("UNIFI_URL");
  });
});
