import { readdirSync, readFileSync } from "node:fs";

// POSTGRES_PASSWORD rides the same /run/secrets mount as every other secret,
// but it must never land in process.env: drizzle gets the password only via
// DATABASE_URL (built by databaseUrlFromSecret in ./db/pool), so leaving it
// out of the env keeps the raw password out of anything that dumps env vars
// (logs, error reports, child process spawns).
const DENY = new Set(["POSTGRES_PASSWORD"]);

// Secret-backed config that the Swarm delivers as docker secret files mounted
// at /run/secrets/<NAME> (never as env vars, so values stay out of the service
// spec and image). Hydrate each into `src` (default process.env) so the rest
// of the app reads it via the schema. Listless: whatever is mounted gets
// hydrated (no fixed name list to keep in sync), except the deny-list above.
// An explicit env var always wins; a missing directory (dev/test) is a no-op.
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
