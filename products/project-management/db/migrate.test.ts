import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runMigrationsWithPool } from "./migrate";

type QueryCall = {
  readonly sql: string;
  readonly params?: readonly unknown[];
};

describe("project management migrations", () => {
  it("applies unapplied sql migrations once and records them", async () => {
    const migrationsDir = await mkdtemp(join(tmpdir(), "project-management-migrations-"));
    await writeFile(join(migrationsDir, "0002_second.sql"), "CREATE TABLE second_probe (id text);");
    await writeFile(join(migrationsDir, "0001_first.sql"), "CREATE TABLE first_probe (id text);");
    const client = fakeMigrationClient();

    await runMigrationsWithPool({ connect: async () => client }, migrationsDir);

    expect(client.released).toBe(true);
    expect(client.calls.map((call) => call.sql.trim())).toEqual([
      expect.stringContaining("CREATE TABLE IF NOT EXISTS project_management_migrations"),
      "SELECT 1 FROM project_management_migrations WHERE id = $1",
      "BEGIN",
      "CREATE TABLE first_probe (id text);",
      "INSERT INTO project_management_migrations (id) VALUES ($1)",
      "COMMIT",
      "SELECT 1 FROM project_management_migrations WHERE id = $1",
      "BEGIN",
      "CREATE TABLE second_probe (id text);",
      "INSERT INTO project_management_migrations (id) VALUES ($1)",
      "COMMIT",
    ]);
    expect(client.calls[1]?.params).toEqual(["0001_first"]);
    expect(client.calls[6]?.params).toEqual(["0002_second"]);
  });

  it("skips migrations already present in the local migrations table", async () => {
    const migrationsDir = await mkdtemp(join(tmpdir(), "project-management-migrations-"));
    await writeFile(join(migrationsDir, "0001_first.sql"), "CREATE TABLE first_probe (id text);");
    const client = fakeMigrationClient({ appliedIds: new Set(["0001_first"]) });

    await runMigrationsWithPool({ connect: async () => client }, migrationsDir);

    expect(client.calls.map((call) => call.sql.trim())).not.toContain("BEGIN");
    expect(client.calls.map((call) => call.sql.trim())).not.toContain(
      "CREATE TABLE first_probe (id text);",
    );
  });
});

function fakeMigrationClient(options: { readonly appliedIds?: ReadonlySet<string> } = {}) {
  const calls: QueryCall[] = [];
  return {
    calls,
    released: false,
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      if (sql.startsWith("SELECT 1 FROM project_management_migrations")) {
        const id = params?.[0];
        return { rowCount: typeof id === "string" && options.appliedIds?.has(id) ? 1 : 0 };
      }
      return { rowCount: 0 };
    },
    release() {
      this.released = true;
    },
  };
}
