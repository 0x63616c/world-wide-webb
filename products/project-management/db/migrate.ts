import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createProjectManagementPool } from "./client";

type MigrationQueryResult = {
  readonly rowCount: number | null;
};

type MigrationClient = {
  readonly query: (sql: string, params?: unknown[]) => Promise<MigrationQueryResult>;
  readonly release: () => void;
};

type MigrationPool = {
  readonly connect: () => Promise<MigrationClient>;
};

export type MigrationRunnerOptions = {
  readonly databaseUrl?: string;
  readonly migrationsDir?: string;
};

export const DEFAULT_MIGRATIONS_DIR = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "migrations",
);

export async function runProjectManagementMigrations(
  options: MigrationRunnerOptions = {},
): Promise<void> {
  const pool = createProjectManagementPool(options.databaseUrl);
  try {
    await runMigrationsWithPool(pool, options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR);
  } finally {
    await pool.end();
  }
}

export async function runMigrationsWithPool(
  pool: MigrationPool,
  migrationsDir: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await ensureMigrationTable(client);
    const migrations = await migrationFiles(migrationsDir);
    for (const migration of migrations) await applyMigration(client, migrationsDir, migration);
  } finally {
    client.release();
  }
}

async function ensureMigrationTable(client: MigrationClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS project_management_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function migrationFiles(migrationsDir: string): Promise<string[]> {
  const files = await readdir(migrationsDir);
  return files.filter((file) => file.endsWith(".sql")).sort();
}

async function applyMigration(
  client: MigrationClient,
  migrationsDir: string,
  migration: string,
): Promise<void> {
  const id = basename(migration, ".sql");
  const applied = await client.query("SELECT 1 FROM project_management_migrations WHERE id = $1", [
    id,
  ]);
  if ((applied.rowCount ?? 0) > 0) return;

  const sql = await readFile(join(migrationsDir, migration), "utf8");
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("INSERT INTO project_management_migrations (id) VALUES ($1)", [id]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
