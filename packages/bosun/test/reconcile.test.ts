import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CloudflareRouteClient,
  makeDefaultCloudflareRouteClient,
  reconcileRoutes,
} from "../src/reconcile/routes.ts";
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
    // Secret name must include a hash of the value and the declared name.
    // (The cc_ prefix is legacy; namespace migration is deferred to CC-8pt.)
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
// reconcile/routes.ts — live Cloudflare client (GET -> merge -> PUT)
// ---------------------------------------------------------------------------

const CF_ACCT = "acct123";
const CF_TUNNEL = "tunnel123";
const CF_CONFIG_URL = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCT}/cfd_tunnel/${CF_TUNNEL}/configurations`;

// Build a live client whose fetch is stubbed. The GET returns `ingress`; PUTs
// are captured so we can assert the merged config written back to Cloudflare.
function makeLiveClient(
  ingress: Array<{ hostname?: string; service: string }>,
  origins: Record<string, string> = {},
) {
  const puts: Array<{ ingress: Array<{ hostname?: string; service: string }> }> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe(CF_CONFIG_URL);
    if (!init || init.method === undefined || init.method === "GET") {
      return new Response(JSON.stringify({ success: true, result: { config: { ingress } } }), {
        status: 200,
      });
    }
    if (init.method === "PUT") {
      puts.push(JSON.parse(init.body as string).config);
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    throw new Error(`unexpected method ${init.method}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = makeDefaultCloudflareRouteClient(
    CF_ACCT,
    CF_TUNNEL,
    "cf-token",
    (h) => origins[h] ?? "",
  );
  return { client, puts, fetchMock };
}

describe("reconcile/routes — live Cloudflare client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("createRoute inserts the declared hostname before the catch-all and PUTs", async () => {
    const { client, puts } = makeLiveClient(
      [
        { hostname: "dashboard.worldwidewebb.co", service: "http://web:80" },
        { service: "http_status:404" },
      ],
      { "hooks.worldwidewebb.co": "http://bosun-agent:4202" },
    );
    await client.createRoute("hooks.worldwidewebb.co", "bosun:control-center");
    expect(puts).toHaveLength(1);
    const written = puts[0].ingress;
    // New rule sits immediately before the catch-all (the rule with no hostname).
    expect(written.map((r) => r.hostname)).toEqual([
      "dashboard.worldwidewebb.co",
      "hooks.worldwidewebb.co",
      undefined,
    ]);
    expect(written[1].service).toBe("http://bosun-agent:4202");
  });

  it("createRoute is a no-op (no PUT) when the hostname already exists", async () => {
    const { client, puts } = makeLiveClient(
      [
        { hostname: "hooks.worldwidewebb.co", service: "http://bosun-agent:4202" },
        { service: "http_status:404" },
      ],
      { "hooks.worldwidewebb.co": "http://bosun-agent:4202" },
    );
    await client.createRoute("hooks.worldwidewebb.co", "bosun:control-center");
    expect(puts).toHaveLength(0);
  });

  it("createRoute throws when no origin service is known for the hostname", async () => {
    const { client } = makeLiveClient([{ service: "http_status:404" }], {});
    await expect(client.createRoute("hooks.worldwidewebb.co", "t")).rejects.toThrow(/origin/i);
  });

  it("deleteRoute removes the matching hostname rule and PUTs the rest", async () => {
    const { client, puts } = makeLiveClient([
      { hostname: "hooks-test.worldwidewebb.co", service: "http://evee-web:4201" },
      { hostname: "dashboard.worldwidewebb.co", service: "http://web:80" },
      { service: "http_status:404" },
    ]);
    await client.deleteRoute("hooks-test.worldwidewebb.co");
    expect(puts).toHaveLength(1);
    expect(puts[0].ingress.map((r) => r.hostname)).toEqual([
      "dashboard.worldwidewebb.co",
      undefined,
    ]);
  });

  it("listRoutes returns hostnames keyed by hostname id, skipping the catch-all", async () => {
    const { client } = makeLiveClient([
      { hostname: "dashboard.worldwidewebb.co", service: "http://web:80" },
      { service: "http_status:404" },
    ]);
    const routes = await client.listRoutes();
    expect(routes).toEqual([
      { id: "dashboard.worldwidewebb.co", hostname: "dashboard.worldwidewebb.co", tags: [] },
    ]);
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

  it("mounts each secret at /run/secrets/<name> without double-nesting the path", () => {
    const yml = renderStackYml(spec, secretNames);
    // Docker mounts a secret's `target` *under* /run/secrets/, so `target` must
    // be the bare filename. Emitting the full path double-nests the mount to
    // /run/secrets//run/secrets/<name>, so the app reading /run/secrets/<name>
    // finds nothing (this caused the api to fall back to its default DB → PG
    // 3D000 and crashloop in prod).
    expect(yml).toContain("target: HA_TOKEN");
    expect(yml).not.toContain("target: /run/secrets/");
  });

  it("includes service images", () => {
    const yml = renderStackYml(spec, secretNames);
    expect(yml).toContain("ghcr.io/0x63616c/control-center-api:main");
    expect(yml).toContain("ghcr.io/0x63616c/control-center-web:main");
  });

  // CC-czg: deploys must pin our ghcr images to the exact digest CI just built,
  // not the mutable :main tag. A changed digest is a changed spec string, so
  // `docker stack deploy` always rolls the service — without depending on
  // --resolve-image re-resolving :main (which silently failed to roll the agent).
  describe("image digest pinning (CC-czg)", () => {
    const digests = {
      "control-center-api": "sha256:aaa111",
      "control-center-web": "sha256:bbb222",
    };

    it("pins an overridden ghcr image to @<digest>, replacing the :main tag", () => {
      const yml = renderStackYml(spec, secretNames, digests);
      expect(yml).toContain("image: ghcr.io/0x63616c/control-center-api@sha256:aaa111");
      expect(yml).toContain("image: ghcr.io/0x63616c/control-center-web@sha256:bbb222");
      // The mutable tag must be gone for pinned services.
      expect(yml).not.toContain("control-center-api:main");
      expect(yml).not.toContain("control-center-web:main");
    });

    it("leaves a ghcr image NOT in the override map on its :main tag (only rebuilt services roll)", () => {
      const yml = renderStackYml(spec, secretNames, { "control-center-api": "sha256:aaa111" });
      expect(yml).toContain("image: ghcr.io/0x63616c/control-center-api@sha256:aaa111");
      expect(yml).toContain("image: ghcr.io/0x63616c/control-center-web:main");
    });

    it("leaves third-party images untouched", () => {
      const tp: Spec = {
        stackName: "control-center",
        services: [
          { name: "postgres", image: "postgres:17-alpine", secrets: [], env: {}, health: [] },
        ],
      };
      const yml = renderStackYml(tp, {}, { "control-center-api": "sha256:aaa111" });
      expect(yml).toContain("image: postgres:17-alpine");
    });

    it("is a no-op when no overrides are given (backward compatible)", () => {
      expect(renderStackYml(spec, secretNames)).toBe(renderStackYml(spec, secretNames, {}));
      expect(renderStackYml(spec, secretNames)).toContain(
        "ghcr.io/0x63616c/control-center-api:main",
      );
    });
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

  it("renders a named volume cc_-prefixed and declares it at top-level (data persists)", () => {
    const volSpec: Spec = {
      stackName: "control-center",
      services: [
        {
          name: "postgres",
          image: "postgres:17-alpine",
          secrets: [],
          env: {},
          volumes: ["pgdata:/var/lib/postgresql/data"],
          health: [],
        },
      ],
    };
    const yml = renderStackYml(volSpec, {});
    // Mount uses the cc_-prefixed name so it reuses the managed cc_pgdata volume.
    expect(yml).toContain("- cc_pgdata:/var/lib/postgresql/data");
    // Top-level volumes block pins the real docker volume name (not stack-prefixed).
    expect(yml).toContain("volumes:");
    expect(yml).toContain("  cc_pgdata:");
    expect(yml).toContain("    name: cc_pgdata");
  });

  it("passes bind mounts through unchanged and does not declare them as named volumes", () => {
    const bindSpec: Spec = {
      stackName: "control-center",
      services: [
        {
          name: "socket-user",
          image: "some/image:latest",
          secrets: [],
          env: {},
          volumes: ["/var/run/docker.sock:/var/run/docker.sock:ro"],
          health: [],
        },
      ],
    };
    const yml = renderStackYml(bindSpec, {});
    expect(yml).toContain("- /var/run/docker.sock:/var/run/docker.sock:ro");
    // No cc_-prefix and no top-level volumes block for a bind mount.
    expect(yml).not.toContain("cc_/var");
    expect(yml).not.toMatch(/\nvolumes:/);
  });
});

describe("renderStackYml — command interpolation escaping", () => {
  it("escapes $ in a service command so docker stack deploy passes it through literally", () => {
    // docker stack deploy interpolates the compose file; a literal `$` must be
    // written as `$$` or it errors ("invalid interpolation format"). cloudflared
    // reads its token at runtime via $(cat /run/secrets/TUNNEL_TOKEN).
    const spec: Spec = {
      stackName: "control-center",
      services: [
        {
          name: "cloudflared",
          image: "cloudflare/cloudflared:x",
          secrets: [],
          env: {},
          command: "tunnel run --token $(cat /run/secrets/TUNNEL_TOKEN)",
          health: [],
        },
      ],
    };
    const yml = renderStackYml(spec, {});
    expect(yml).toContain("command: tunnel run --token $$(cat /run/secrets/TUNNEL_TOKEN)");
    // The un-escaped form must not survive, or the deploy is rejected.
    expect(yml).not.toContain("--token $(cat");
  });
});

describe("renderStackYml — cron jobs are excluded from the deployed stack", () => {
  // Cron jobs run as one-shot Swarm jobs spun up by the bosun scheduler, NOT as
  // long-lived stack services, so renderStackYml must omit them entirely.
  const jobSpec: Spec = {
    stackName: "control-center",
    services: [
      {
        name: "prune",
        image: "docker:cli",
        secrets: [],
        env: {},
        command: "docker system prune -af",
        schedule: { cron: "30 3 * * *" },
        health: [],
      },
      {
        name: "web",
        image: "ghcr.io/x/web:main",
        secrets: [],
        env: {},
        port: 80,
        health: [],
      },
    ],
  };

  it("does NOT render a service block or deploy labels for a cron job", () => {
    const yml = renderStackYml(jobSpec, {});
    expect(yml).not.toContain("  prune:");
    expect(yml).not.toContain("docker system prune -af");
    // No scheduler deploy-label mechanism survives — the job isn't in the stack.
    expect(yml).not.toContain(".schedule=");
    expect(yml).not.toContain(".command=");
  });

  it("still renders the non-job services normally", () => {
    const yml = renderStackYml(jobSpec, {});
    expect(yml).toContain("  web:");
    expect(yml).toContain("    image: ghcr.io/x/web:main");
    expect(yml).toContain("bosun.stack=control-center");
  });

  it("is deterministic for specs containing cron jobs", () => {
    expect(renderStackYml(jobSpec, {})).toBe(renderStackYml(jobSpec, {}));
  });
});
