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
  });

  it("keeps Tilt resource ordering explicit", async () => {
    const tiltfile = await readProjectFile("Tiltfile");
    expect(tiltfile).toContain("docker_compose('docker-compose.temporal.yml')");
    expect(tiltfile).toContain("resource_deps=['install', 'temporal-postgres']");
    expect(tiltfile).toContain("'temporal-ready'");
    expect(tiltfile).toContain("resource_deps=['install', 'temporal-ready']");
    expect(tiltfile).toContain("resource_deps=['install', 'worker']");
    expect(tiltfile).toContain("temporal operator cluster health");
  });
});
