import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, test } from "vitest";
// Moved from packages/core/test/{hydrate,pool}.test.ts when hydration moved into
// @www/platform/env (design spec §3, §5.7) — so no core test imports platform.
import { databaseUrlFromSecret, hydrateSecretFiles } from "../env";

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
