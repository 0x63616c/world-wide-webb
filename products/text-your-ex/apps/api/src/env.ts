import { readFileSync } from "node:fs";

// Build DATABASE_URL from explicit env var (wins) or from a Postgres password file
// mounted at /run/secrets/POSTGRES_PASSWORD (k8s ESO pattern, same as control-center).
export function buildDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const pwFile = process.env.POSTGRES_PASSWORD_FILE ?? "/run/secrets/POSTGRES_PASSWORD";
  let password: string;
  try {
    password = readFileSync(pwFile, "utf-8").trim();
  } catch {
    throw new Error(
      "TYE: DATABASE_URL or POSTGRES_PASSWORD_FILE must be set. " +
        "For local dev set DATABASE_URL=postgresql://postgres:password@localhost:5432/text_your_ex",
    );
  }
  const host = process.env.POSTGRES_HOST ?? "localhost";
  const port = process.env.POSTGRES_PORT ?? "5432";
  const user = process.env.POSTGRES_USER ?? "postgres";
  const name = process.env.POSTGRES_DB ?? "text_your_ex";
  return `postgresql://${user}:${encodeURIComponent(password)}@${host}:${port}/${name}`;
}
