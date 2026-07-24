/**
 * Secret-file hydration — the boundary where `/run/secrets/*` files become
 * `process.env` values, and where `DATABASE_URL` is derived from the mounted
 * `POSTGRES_PASSWORD` secret. Moved verbatim from `@www/core` (packages/core/
 * src/secrets/hydrate.ts + db/pool.ts) so the env registry owns env end-to-end
 * (design spec §3, §5.7). This file is the sanctioned `process.env` writer and
 * carries the Biome `noProcessEnv` carve-out.
 */
import { readdirSync, readFileSync } from "node:fs";

// POSTGRES_PASSWORD rides the same /run/secrets mount as every other secret,
// but it must never land in process.env: drizzle gets the password only via
// DATABASE_URL (built by databaseUrlFromSecret below), so leaving it out of the
// env keeps the raw password out of anything that dumps env vars (logs, error
// reports, child process spawns).
const DENY = new Set(["POSTGRES_PASSWORD"]);

/**
 * Secret-backed config that the Swarm delivers as docker secret files mounted
 * at /run/secrets/<NAME> (never as env vars, so values stay out of the service
 * spec and image). Hydrate each into `src` (default process.env) so the rest of
 * the app reads it via the registry. Listless: whatever is mounted gets
 * hydrated (no fixed name list to keep in sync), except the deny-list above. An
 * explicit env var always wins; a missing directory (dev/test) is a no-op.
 */
export function hydrateSecretFiles(
  src: Record<string, string | undefined> = process.env,
  dir = "/run/secrets",
): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return; // dir absent (dev/test) -> no-op
  }
  for (const name of names) {
    if (src[name] !== undefined || DENY.has(name)) continue;
    try {
      const value = readFileSync(`${dir}/${name}`, "utf-8").trim();
      if (value) src[name] = value;
    } catch {
      // not a readable file - skip
    }
  }
}

/**
 * Build DATABASE_URL from the mounted POSTGRES_PASSWORD secret file plus the
 * POSTGRES_* service env. An explicit DATABASE_URL (local dev, tests, CI) always
 * wins; when no secret is mounted (dev/test) we return undefined and the
 * registry's DATABASE_URL default/devDefault applies.
 */
export function databaseUrlFromSecret(
  src: Record<string, string | undefined> = process.env,
): string | undefined {
  if (src.DATABASE_URL) return src.DATABASE_URL;
  const pwFile = src.POSTGRES_PASSWORD_FILE ?? "/run/secrets/POSTGRES_PASSWORD";
  let password: string;
  try {
    password = readFileSync(pwFile, "utf-8").trim();
  } catch {
    return undefined;
  }
  if (!password) return undefined;
  const host = src.POSTGRES_HOST ?? "postgres";
  const port = src.POSTGRES_PORT ?? "5432";
  const user = src.POSTGRES_USER ?? "postgres";
  const name = src.POSTGRES_DB ?? "control_center";
  return `postgresql://${user}:${encodeURIComponent(password)}@${host}:${port}/${name}`;
}
