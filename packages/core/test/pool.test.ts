import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { databaseUrlFromSecret } from "../src/db/pool";

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
