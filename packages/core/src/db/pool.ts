import { readFileSync } from "node:fs";
import { Pool } from "pg";

// In the Swarm the Postgres password arrives as a mounted docker secret file,
// never as a literal env var (so it stays out of the service spec and image).
// Build DATABASE_URL from that secret plus the POSTGRES_* service env. An
// explicit DATABASE_URL (local dev, tests, CI) always wins; when no secret is
// mounted (dev/test) we return undefined and the schema default applies.
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

export function createPool(url: string): Pool {
  return new Pool({ connectionString: url });
}
