import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const projectRoot = new URL("./", import.meta.url);

async function readProjectFile(path: string): Promise<string> {
  return await readFile(new URL(path, projectRoot), "utf8");
}

describe("Temporal dev stack", () => {
  it("uses Postgres persistence instead of the SQLite dev-server flag", async () => {
    const packageJson = await readProjectFile("package.json");
    const tiltfile = await readProjectFile("Tiltfile");
    const compose = await readProjectFile("docker-compose.temporal.yml");

    expect(`${packageJson}\n${tiltfile}`).not.toContain("--db-filename");
    expect(compose).toContain("temporal-postgres-data");
    expect(compose).toContain("DB: postgres12");
    expect(compose).toContain("temporalio/auto-setup");
    expect(compose).toContain('"--address", "temporal:7233"');
  });

  it("keeps Tilt resource ordering explicit", async () => {
    const tiltfile = await readProjectFile("Tiltfile");
    expect(tiltfile).toContain("docker_compose('docker-compose.temporal.yml')");
    expect(tiltfile).toContain("resource_deps=['install', 'temporal-postgres']");
    expect(tiltfile).toContain("'temporal-ready'");
    expect(tiltfile).toContain(
      "deps=['docker-compose.temporal.yml', 'temporal/dynamicconfig/development-sql.yaml']",
    );
    expect(tiltfile).toContain(
      "resource_deps=['install', 'temporal-ready', 'project-management-db']",
    );
    expect(tiltfile).toContain("resource_deps=['install', 'worker']");
    expect(tiltfile).toContain("readiness_probe=probe(");
    expect(tiltfile).toContain("TEMPORAL_WORKER_HEALTH_PORT");
    expect(tiltfile).toContain("http://127.0.0.1:%d/health' % TEMPORAL_WORKER_HEALTH_PORT");
    expect(tiltfile).toContain("temporal operator cluster health");
    expect(tiltfile).toContain("--address temporal:%d");
  });

  it("creates and wires the isolated project management database", async () => {
    const tiltfile = await readProjectFile("Tiltfile");
    const compose = await readProjectFile("docker-compose.temporal.yml");

    expect(compose).toContain('"5433:5432"');
    expect(tiltfile).toContain("PROJECT_MANAGEMENT_DATABASE_URL");
    expect(tiltfile).toContain("postgresql://temporal:temporal@127.0.0.1:5433/project_management");
    expect(tiltfile).toContain("'project-management-db'");
    expect(tiltfile).toContain("CREATE DATABASE project_management");
    expect(tiltfile).toContain("WHERE NOT EXISTS");
    expect(tiltfile).toContain(
      "resource_deps=['install', 'temporal-ready', 'project-management-db']",
    );
  });

  it("runs migrations before the server and worker start serving work", async () => {
    const server = await readProjectFile("server.ts");
    const worker = await readProjectFile("temporal/worker.ts");

    expect(server.indexOf("await options.runMigrations();")).toBeLessThan(
      server.indexOf("Bun.serve({"),
    );
    expect(worker.indexOf("await dependencies.runMigrations();")).toBeLessThan(
      worker.indexOf("const connection = await connectToTemporal"),
    );
    expect(server).toContain("runProjectManagementMigrations");
    expect(worker).toContain("runProjectManagementMigrations");
  });

  it("exposes a worker-owned health endpoint", async () => {
    const worker = await readProjectFile("temporal/worker.ts");

    expect(worker).toContain("TEMPORAL_WORKER_HEALTH_PORT");
    expect(worker).toContain('pathname !== "/health"');
    expect(worker).toContain("startHealthServer(options)");
  });
});
