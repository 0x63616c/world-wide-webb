import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { hydrateSecretFiles } from "../src/secrets/hydrate";

it("hydrates arbitrary mounted files but NOT POSTGRES_PASSWORD", () => {
  const dir = mkdtempSync(join(tmpdir(), "secrets-"));
  writeFileSync(join(dir, "HA_TOKEN"), "tok\n");
  writeFileSync(join(dir, "POSTGRES_PASSWORD"), "pw\n");
  const env: Record<string, string | undefined> = {};
  hydrateSecretFiles(env, dir);
  expect(env.HA_TOKEN).toBe("tok");
  expect(env.POSTGRES_PASSWORD).toBeUndefined();
});

it("does not overwrite an explicit env var", () => {
  const dir = mkdtempSync(join(tmpdir(), "secrets-"));
  writeFileSync(join(dir, "HA_TOKEN"), "file");
  const env = { HA_TOKEN: "explicit" };
  hydrateSecretFiles(env, dir);
  expect(env.HA_TOKEN).toBe("explicit");
});
