import { describe, expect, it, vi } from "vitest";
import { type CloudflareRouteClient, reconcileRoutes } from "../src/reconcile/routes.ts";
import { type DockerSecretClient, reconcileSecrets } from "../src/reconcile/secrets.ts";
import { renderStackYml } from "../src/reconcile/stack.ts";
import type { Spec } from "../src/spec.ts";

// ---------------------------------------------------------------------------
// reconcile/secrets.ts
// ---------------------------------------------------------------------------

// The key safety invariant: label-scoped prune never touches a foreign secret.
// We mock the docker secret client so no real swarm is required.

const STACK = "control-center";

function makeDockerClient(
  existingSecrets: Array<{ name: string; labels: Record<string, string> }>,
): DockerSecretClient {
  const secrets = [...existingSecrets];
  return {
    listSecrets: vi.fn().mockResolvedValue(secrets),
    createSecret: vi.fn().mockResolvedValue(undefined),
    removeSecret: vi.fn().mockResolvedValue(undefined),
    inspectSecret: vi.fn().mockImplementation(async (name: string) => {
      const s = secrets.find((x) => x.name === name);
      return s ?? null;
    }),
  };
}

describe("reconcile/secrets — prune safety", () => {
  it("creates declared secrets that do not exist yet", async () => {
    const client = makeDockerClient([]);
    await reconcileSecrets(STACK, [{ name: "HA_TOKEN", resolvedValue: "tok123" }], client);
    expect(client.createSecret).toHaveBeenCalledOnce();
    // Secret name must include a hash of the value and the declared name.
    const [nameArg] = (client.createSecret as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(nameArg).toMatch(/^cc_HA_TOKEN_/);
  });

  it("does NOT create a secret that already exists with a matching hash", async () => {
    // Pre-seed with the exact hashed name that would be derived for "tok123".
    // We don't know the hash in the test, so we run once to learn it, then
    // verify idempotency by running again on the resulting state.
    const client1 = makeDockerClient([]);
    await reconcileSecrets(STACK, [{ name: "HA_TOKEN", resolvedValue: "tok123" }], client1);
    const [[createdName]] = (client1.createSecret as ReturnType<typeof vi.fn>).mock.calls;

    // Simulate the secret now existing.
    const client2 = makeDockerClient([{ name: createdName, labels: { "bosun.stack": STACK } }]);
    await reconcileSecrets(STACK, [{ name: "HA_TOKEN", resolvedValue: "tok123" }], client2);
    // No second create — already present.
    expect(client2.createSecret).not.toHaveBeenCalled();
  });

  it("prunes a stack-labelled orphan secret that is no longer declared", async () => {
    const orphan = { name: "cc_OLD_TOKEN_deadbeef", labels: { "bosun.stack": STACK } };
    const client = makeDockerClient([orphan]);
    await reconcileSecrets(STACK, [], client);
    expect(client.removeSecret).toHaveBeenCalledWith("cc_OLD_TOKEN_deadbeef");
  });

  it("does NOT prune a secret without the stack label (foreign secret safety)", async () => {
    // This is the critical invariant: a secret from another stack or manually
    // created without the label must never be touched.
    const foreign = { name: "some_other_service_secret", labels: {} };
    const client = makeDockerClient([foreign]);
    await reconcileSecrets(STACK, [], client);
    expect(client.removeSecret).not.toHaveBeenCalled();
  });

  it("does NOT prune a secret labelled for a different bosun stack", async () => {
    const otherStack = { name: "cc_OTHER_deadbeef", labels: { "bosun.stack": "some-other-stack" } };
    const client = makeDockerClient([otherStack]);
    await reconcileSecrets(STACK, [], client);
    expect(client.removeSecret).not.toHaveBeenCalled();
  });

  it("prunes orphan and leaves foreign untouched in the same call", async () => {
    const orphan = { name: "cc_ORPHAN_aabbccdd", labels: { "bosun.stack": STACK } };
    const foreign = { name: "portainer_admin_secret", labels: {} };
    const client = makeDockerClient([orphan, foreign]);
    await reconcileSecrets(STACK, [], client);
    expect(client.removeSecret).toHaveBeenCalledOnce();
    expect(client.removeSecret).toHaveBeenCalledWith(orphan.name);
  });

  it("returns the hashed secret names so the stack can reference them", async () => {
    const client = makeDockerClient([]);
    const result = await reconcileSecrets(
      STACK,
      [
        { name: "HA_TOKEN", resolvedValue: "tok1" },
        { name: "UNIFI_KEY", resolvedValue: "key2" },
      ],
      client,
    );
    expect(result).toHaveProperty("HA_TOKEN");
    expect(result).toHaveProperty("UNIFI_KEY");
    // Values are the docker secret names (hashed), not the secret values.
    expect(result.HA_TOKEN).toMatch(/^cc_HA_TOKEN_/);
    expect(result.UNIFI_KEY).toMatch(/^cc_UNIFI_KEY_/);
  });
});

// ---------------------------------------------------------------------------
// reconcile/routes.ts
// ---------------------------------------------------------------------------

function makeRouteClient(
  existingRoutes: Array<{ id: string; hostname: string; tags: string[] }>,
): CloudflareRouteClient {
  const routes = [...existingRoutes];
  return {
    listRoutes: vi.fn().mockResolvedValue(routes),
    createRoute: vi.fn().mockResolvedValue({ id: "new-route-id" }),
    deleteRoute: vi.fn().mockResolvedValue(undefined),
  };
}

const ROUTE_TAG = "bosun:control-center";

describe("reconcile/routes — prune safety", () => {
  it("creates a declared route that does not exist yet", async () => {
    const client = makeRouteClient([]);
    await reconcileRoutes(STACK, ["dashboard.worldwidewebb.co"], client);
    expect(client.createRoute).toHaveBeenCalledOnce();
  });

  it("does NOT create a route that already exists", async () => {
    const existing = [{ id: "r1", hostname: "dashboard.worldwidewebb.co", tags: [ROUTE_TAG] }];
    const client = makeRouteClient(existing);
    await reconcileRoutes(STACK, ["dashboard.worldwidewebb.co"], client);
    expect(client.createRoute).not.toHaveBeenCalled();
  });

  it("prunes a stack-tagged orphan route that is no longer declared", async () => {
    const orphan = { id: "orphan-id", hostname: "old.worldwidewebb.co", tags: [ROUTE_TAG] };
    const client = makeRouteClient([orphan]);
    await reconcileRoutes(STACK, [], client);
    expect(client.deleteRoute).toHaveBeenCalledWith("orphan-id");
  });

  it("does NOT prune a route without the stack tag (foreign route safety)", async () => {
    // A manually-created or differently-managed CF route must never be deleted.
    const foreign = { id: "foreign-id", hostname: "unrelated.worldwidewebb.co", tags: [] };
    const client = makeRouteClient([foreign]);
    await reconcileRoutes(STACK, [], client);
    expect(client.deleteRoute).not.toHaveBeenCalled();
  });

  it("does NOT prune a route tagged for a different stack", async () => {
    const other = {
      id: "other-id",
      hostname: "other.worldwidewebb.co",
      tags: ["bosun:other-project"],
    };
    const client = makeRouteClient([other]);
    await reconcileRoutes(STACK, [], client);
    expect(client.deleteRoute).not.toHaveBeenCalled();
  });

  it("prunes stack orphan and leaves foreign route untouched in the same call", async () => {
    const orphan = { id: "orphan-id", hostname: "old.worldwidewebb.co", tags: [ROUTE_TAG] };
    const foreign = { id: "foreign-id", hostname: "portainer.worldwidewebb.co", tags: [] };
    const client = makeRouteClient([orphan, foreign]);
    await reconcileRoutes(STACK, [], client);
    expect(client.deleteRoute).toHaveBeenCalledOnce();
    expect(client.deleteRoute).toHaveBeenCalledWith("orphan-id");
  });
});

// ---------------------------------------------------------------------------
// reconcile/stack.ts
// ---------------------------------------------------------------------------

describe("renderStackYml", () => {
  const spec: Spec = {
    stackName: "control-center",
    services: [
      {
        name: "api",
        image: "ghcr.io/0x63616c/control-center-api:main",
        secrets: [{ name: "HA_TOKEN", ref: "op://Homelab/HA/credential" }],
        env: { HA_URL: "http://host.docker.internal:8123" },
        port: 4201,
        health: [],
      },
      {
        name: "web",
        image: "ghcr.io/0x63616c/control-center-web:main",
        secrets: [],
        env: {},
        route: "dashboard.worldwidewebb.co",
        port: 80,
        proxyApiTo: "api:4201",
        health: [],
      },
    ],
  };

  // Hashed secret names returned from reconcileSecrets.
  const secretNames: Record<string, string> = {
    HA_TOKEN: "cc_HA_TOKEN_aabb1234",
  };

  it("produces a YAML string containing the stack name as a label", () => {
    const yml = renderStackYml(spec, secretNames);
    expect(yml).toContain("control-center");
  });

  it("references hashed docker secret names, not plain names", () => {
    const yml = renderStackYml(spec, secretNames);
    expect(yml).toContain("cc_HA_TOKEN_aabb1234");
    // The plain unscoped name must not appear as a docker secret reference.
    expect(yml).not.toContain("source: HA_TOKEN");
  });

  it("includes service images", () => {
    const yml = renderStackYml(spec, secretNames);
    expect(yml).toContain("ghcr.io/0x63616c/control-center-api:main");
    expect(yml).toContain("ghcr.io/0x63616c/control-center-web:main");
  });

  it("includes env vars for the api service", () => {
    const yml = renderStackYml(spec, secretNames);
    expect(yml).toContain("HA_URL");
  });

  it("is deterministic — two calls with the same input produce identical output", () => {
    const yml1 = renderStackYml(spec, secretNames);
    const yml2 = renderStackYml(spec, secretNames);
    expect(yml1).toBe(yml2);
  });
});

describe("renderStackYml — scheduled jobs (ofelia labels)", () => {
  const jobSpec: Spec = {
    stackName: "control-center",
    services: [
      {
        name: "prune",
        image: "docker:cli",
        secrets: [],
        env: {},
        command: "docker system prune -af",
        schedule: { cron: "30 3 * * *", jobType: "job-run" },
        health: [],
      },
      {
        name: "ofelia",
        image: "mcuadros/ofelia:latest",
        secrets: [],
        env: {},
        command: "daemon --docker",
        volumes: ["/var/run/docker.sock:/var/run/docker.sock:ro"],
        placement: ["node.role==manager"],
        health: [],
      },
    ],
  };

  it("emits ofelia.<jobtype>.<name>.schedule and .command labels", () => {
    const yml = renderStackYml(jobSpec, {});
    expect(yml).toContain("ofelia.job-run.prune.schedule=");
    expect(yml).toContain("ofelia.job-run.prune.command=docker system prune -af");
  });

  it("translates the 5-field spec cron to Ofelia's 6-field by prepending '0 '", () => {
    const yml = renderStackYml(jobSpec, {});
    expect(yml).toContain("ofelia.job-run.prune.schedule=0 30 3 * * *");
  });

  it("still emits the bosun.stack label alongside the ofelia labels", () => {
    const yml = renderStackYml(jobSpec, {});
    expect(yml).toContain("bosun.stack=control-center");
  });

  it("renders the controller's socket volume and manager placement", () => {
    const yml = renderStackYml(jobSpec, {});
    expect(yml).toContain("- /var/run/docker.sock:/var/run/docker.sock:ro");
    expect(yml).toContain("- node.role==manager");
  });

  it("a one-shot job restarts with condition: none, not on-failure", () => {
    const yml = renderStackYml(jobSpec, {});
    // The prune job block must carry condition: none.
    const pruneBlock = yml.slice(yml.indexOf("  prune:"), yml.indexOf("  ofelia:"));
    expect(pruneBlock).toContain("condition: none");
  });

  it("is deterministic for job specs", () => {
    expect(renderStackYml(jobSpec, {})).toBe(renderStackYml(jobSpec, {}));
  });
});
