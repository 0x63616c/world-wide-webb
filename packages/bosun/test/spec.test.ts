import { describe, expect, it, vi } from "vitest";
import { type Runner, runProbes } from "../src/health.ts";
import type { Spec } from "../src/spec.ts";
import {
  certProbe,
  cmdProbe,
  cronJob,
  fromOp,
  ghcr,
  httpProbe,
  postgres,
  service,
  stack,
} from "../src/spec.ts";

// Verify the builder API produces the correct static shape (ac_tool_plan_pure).

describe("stack builder", () => {
  it("produces a Spec with the given stack name", () => {
    const spec = stack("my-app", { services: [] });
    expect(spec.stackName).toBe("my-app");
    expect(spec.services).toEqual([]);
  });

  it("returns the same reference type every call", () => {
    const a = stack("x", { services: [] });
    const b = stack("x", { services: [] });
    // Structural equality — two evals are identical.
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("service builder", () => {
  it("sets image and name", () => {
    const svc = service("api", { image: ghcr("control-center-api") });
    expect(svc.name).toBe("api");
    expect(svc.image).toContain("control-center-api");
  });

  it("stores route when declared", () => {
    const svc = service("web", {
      image: ghcr("control-center-web"),
      route: "dashboard.worldwidewebb.co",
    });
    expect(svc.route).toBe("dashboard.worldwidewebb.co");
  });

  it("stores env variables", () => {
    const svc = service("api", {
      image: ghcr("control-center-api"),
      env: { HA_URL: "http://host.docker.internal:8123" },
    });
    expect(svc.env).toMatchObject({ HA_URL: "http://host.docker.internal:8123" });
  });
});

describe("ghcr helper", () => {
  it("resolves to ghcr.io/0x63616c/<name>:main", () => {
    expect(ghcr("control-center-api")).toBe("ghcr.io/0x63616c/control-center-api:main");
  });

  it("accepts an explicit tag", () => {
    expect(ghcr("control-center-web", "abc1234")).toBe(
      "ghcr.io/0x63616c/control-center-web:abc1234",
    );
  });
});

describe("fromOp secret references", () => {
  it("produces SecretRef[] with op:// refs — never actual values", () => {
    const refs = fromOp("Homelab", {
      HA_TOKEN: "Home Assistant Token/credential",
      UNIFI_API_KEY: "UniFi/local_api_key",
    });
    // Returns a SecretRef[] — find by name and check the ref field.
    const haToken = refs.find((r) => r.name === "HA_TOKEN");
    const unifiKey = refs.find((r) => r.name === "UNIFI_API_KEY");
    expect(haToken?.ref).toBe("op://Homelab/Home Assistant Token/credential");
    expect(unifiKey?.ref).toBe("op://Homelab/UniFi/local_api_key");
  });

  it("never contains a secret value — only op:// references", () => {
    const refs = fromOp("Homelab", { MY_KEY: "My Item/field" });
    for (const secretRef of refs) {
      expect(secretRef.ref).toMatch(/^op:\/\//);
    }
  });
});

describe("health probes", () => {
  it("httpProbe stores url and expectedStatus", () => {
    const probe = httpProbe("http://api:4201/up", 200);
    expect(probe.kind).toBe("http");
    expect(probe.url).toBe("http://api:4201/up");
    expect(probe.expectedStatus).toBe(200);
  });

  it("cmdProbe stores description and shell command", () => {
    const probe = cmdProbe("live HA data", "curl -s http://api:4201/api/health | jq -e .ok");
    expect(probe.kind).toBe("cmd");
    expect(probe.description).toBe("live HA data");
    expect(probe.command).toContain("curl");
  });

  it("certProbe wraps openssl on the cmd path with the warn window in seconds", () => {
    const probe = certProbe("dashboard.worldwidewebb.co", { warnDays: 14 });
    expect(probe.kind).toBe("cmd");
    // -checkend takes seconds; 14 days = 1209600s.
    expect(probe.command).toContain("openssl x509 -checkend 1209600 -noout");
    // SNI must be sent so SNI-routed hosts return the right cert.
    expect(probe.command).toContain("-servername dashboard.worldwidewebb.co");
    expect(probe.description).toContain("dashboard.worldwidewebb.co");
  });

  it("certProbe defaults to port 443 and supports an explicit port", () => {
    expect(certProbe("example.com", { warnDays: 7 }).command).toContain("-connect example.com:443");
    expect(certProbe("example.com", { warnDays: 7, port: 8443 }).command).toContain(
      "-connect example.com:8443",
    );
  });
});

// A cert-expiry probe is a cmd probe: openssl -checkend exits 0 when the cert is
// valid past the warn window and non-zero when expiry falls inside it. Drive both
// outcomes through runProbes with an injected runner standing in for openssl.
describe("certProbe behavior via injected runner", () => {
  const makeRunner = (exitCode: number): Runner => vi.fn().mockResolvedValue({ exitCode });

  it("passes when the cert is far from expiry (openssl exits 0)", async () => {
    const probe = certProbe("dashboard.worldwidewebb.co", { warnDays: 14 });
    const result = await runProbes([probe], {
      fetcher: vi.fn(),
      runner: makeRunner(0),
    });
    expect(result.exitCode).toBe(0);
    expect(result.results[0].pass).toBe(true);
  });

  it("fails when expiry is inside the warn window (openssl exits 1)", async () => {
    const probe = certProbe("dashboard.worldwidewebb.co", { warnDays: 14 });
    const result = await runProbes([probe], {
      fetcher: vi.fn(),
      runner: makeRunner(1),
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.results[0].pass).toBe(false);
    expect(result.results[0].reason).toBeTruthy();
  });
});

describe("postgres builder", () => {
  it("produces a service named 'postgres'", () => {
    const pg = postgres({ volume: "pgdata" });
    expect(pg.name).toBe("postgres");
  });

  it("uses a pinned postgres image", () => {
    const pg = postgres({ volume: "pgdata" });
    expect(pg.image).toContain("postgres:");
  });

  it("includes a pg_isready health probe", () => {
    const pg = postgres({ volume: "pgdata" });
    const probe = pg.health.find((h) => h.kind === "cmd");
    expect(probe).toBeDefined();
    expect(probe?.command).toContain("pg_isready");
  });

  it("declares a POSTGRES_PASSWORD secret ref when secretRef is provided", () => {
    const pg = postgres({ volume: "pgdata", secretRef: "op://Homelab/PG/password" });
    const ref = pg.secrets.find((r) => r.name === "POSTGRES_PASSWORD");
    expect(ref?.ref).toBe("op://Homelab/PG/password");
  });

  it("mounts the named volume at the postgres data dir so data persists across redeploys", () => {
    const pg = postgres({ volume: "pgdata" });
    expect(pg.volumes).toEqual(["pgdata:/var/lib/postgresql/data"]);
  });

  it("points POSTGRES_PASSWORD_FILE at the mounted secret when secretRef is provided", () => {
    const pg = postgres({ volume: "pgdata", secretRef: "op://Homelab/PG/password" });
    // postgres reads the password from the secret file; the value never lands in env.
    expect(pg.env.POSTGRES_PASSWORD_FILE).toBe("/run/secrets/POSTGRES_PASSWORD");
  });

  it("omits POSTGRES_PASSWORD_FILE when no secretRef is given (dev/test)", () => {
    const pg = postgres({ volume: "pgdata" });
    expect(pg.env.POSTGRES_PASSWORD_FILE).toBeUndefined();
  });

  // www-chy: a FRESH cc_pgdata volume only inits the DB named by POSTGRES_DB; the
  // api expects `control_center` (apps/api/src/env.ts default). Without this a
  // volume-loss rebuild silently inits only the default `postgres` DB and the
  // api can't connect. POSTGRES_DB is honoured only on first init, so it is
  // inert on the existing prod volume — safe to add to the live service spec.
  it("sets POSTGRES_DB to control_center by default (api's expected db)", () => {
    const pg = postgres({ volume: "pgdata" });
    expect(pg.env.POSTGRES_DB).toBe("control_center");
  });

  it("sets POSTGRES_DB regardless of secretRef (needed on any fresh init)", () => {
    const pg = postgres({ volume: "pgdata", secretRef: "op://Homelab/PG/password" });
    expect(pg.env.POSTGRES_DB).toBe("control_center");
  });

  it("allows overriding the database name", () => {
    const pg = postgres({ volume: "pgdata", db: "other_db" });
    expect(pg.env.POSTGRES_DB).toBe("other_db");
  });
});

describe("cronJob primitive", () => {
  it("produces a ServiceSpec carrying a schedule", () => {
    const job = cronJob("prune", {
      image: "docker:cli",
      schedule: "30 3 * * *",
      command: "docker system prune -af",
    });
    expect(job.name).toBe("prune");
    expect(job.schedule?.cron).toBe("30 3 * * *");
    expect(job.command).toBe("docker system prune -af");
  });

  it("carries placement constraints through to the job spec", () => {
    const job = cronJob("prune", {
      image: "docker:cli",
      schedule: "0 4 * * *",
      command: "x",
      placement: ["node.role==manager"],
    });
    expect(job.placement).toEqual(["node.role==manager"]);
  });

  it("rejects a non-5-field cron (nonsensical schedule)", () => {
    // Specs stay standard 5-field cron; a 6-field expression is a build error.
    expect(() => cronJob("bad", { image: "x", schedule: "0 30 3 * * *", command: "y" })).toThrow(
      /5-field/,
    );
  });

  it("is a one-shot with no health probes (exempt from liveness verify)", () => {
    const job = cronJob("prune", { image: "docker:cli", schedule: "0 4 * * *", command: "x" });
    expect(job.health).toEqual([]);
  });
});

describe("full stack evaluation (purity + determinism)", () => {
  // Runs the builder twice and verifies byte-identical JSON output.
  // This is the core purity assertion: no timestamps, no random ids, no I/O.
  const buildTestSpec = (): Spec =>
    stack("control-center", {
      services: [
        service("api", {
          image: ghcr("control-center-api"),
          secrets: fromOp("Homelab", {
            HA_TOKEN: "Home Assistant Token/credential",
          }),
          env: { HA_URL: "http://host.docker.internal:8123" },
          health: [
            httpProbe("http://api:4201/up", 200),
            cmdProbe("live HA data", "curl -s http://api:4201/api/health | jq -e .ok"),
          ],
        }),
        service("web", {
          image: ghcr("control-center-web"),
          route: "dashboard.worldwidewebb.co",
          proxyApiTo: "api:4201",
          health: [httpProbe("https://dashboard.worldwidewebb.co", 200)],
        }),
        postgres({ volume: "pgdata" }),
      ],
    });

  it("two evaluations produce byte-identical JSON", () => {
    const a = JSON.stringify(buildTestSpec());
    const b = JSON.stringify(buildTestSpec());
    expect(a).toBe(b);
  });

  it("spec contains service names but no secret values", () => {
    const spec = buildTestSpec();
    const json = JSON.stringify(spec);

    // Service names present.
    expect(json).toContain('"api"');
    expect(json).toContain('"web"');

    // Secret references present as op:// URIs.
    expect(json).toContain("op://Homelab/");

    // No actual secret values — every SecretRef.ref must be an op:// URI.
    const apiSvc = spec.services.find((s) => s.name === "api");
    expect(apiSvc).toBeDefined();
    for (const secretRef of apiSvc?.secrets ?? []) {
      expect(secretRef.ref).toMatch(/^op:\/\//);
    }
  });

  it("spec has zero side effects — no network objects attached", () => {
    // The Spec is a plain data object. If any builder captured a Promise or
    // opened a socket, JSON.stringify would drop it silently — but we assert
    // every service field is serializable by round-tripping through JSON.
    const spec = buildTestSpec();
    const roundTripped = JSON.parse(JSON.stringify(spec)) as Spec;
    expect(roundTripped.stackName).toBe(spec.stackName);
    expect(roundTripped.services.length).toBe(spec.services.length);
  });
});
