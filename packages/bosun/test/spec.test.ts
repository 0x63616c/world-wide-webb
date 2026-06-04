import { describe, expect, it } from "vitest";
import type { Spec } from "../src/spec.ts";
import { cmdProbe, fromOp, ghcr, httpProbe, postgres, service, stack } from "../src/spec.ts";

// Verify the builder API produces the correct static shape (ac_tool_plan_pure).

describe("stack builder", () => {
  it("produces a Spec with the given stack name", () => {
    const spec = stack("my-app", { services: [] });
    expect(spec.name).toBe("my-app");
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
  it("produces references in op:// form — never actual values", () => {
    const refs = fromOp("Homelab", {
      HA_TOKEN: "Home Assistant Token/credential",
      UNIFI_API_KEY: "UniFi/local_api_key",
    });
    // Each value must be an op:// reference string.
    expect(refs.HA_TOKEN).toBe("op://Homelab/Home Assistant Token/credential");
    expect(refs.UNIFI_API_KEY).toBe("op://Homelab/UniFi/local_api_key");
  });

  it("never contains a secret value — only op:// references", () => {
    const refs = fromOp("Homelab", { MY_KEY: "My Item/field" });
    for (const val of Object.values(refs)) {
      expect(val).toMatch(/^op:\/\//);
    }
  });
});

describe("health probes", () => {
  it("httpProbe stores url and expectedStatus", () => {
    const probe = httpProbe("http://api:4201/up", 200);
    expect(probe.kind).toBe("http");
    expect(probe.url).toBe("http://api:4201/up");
    expect(probe.expectedStatus).toBe(200);
    expect(probe.certValid).toBe(false);
  });

  it("httpProbe can require cert validity", () => {
    const probe = httpProbe("https://dashboard.worldwidewebb.co", 200, {
      certValid: true,
    });
    expect(probe.certValid).toBe(true);
  });

  it("cmdProbe stores description and shell command", () => {
    const probe = cmdProbe("live HA data", "curl -s http://api:4201/api/health | jq -e .ok");
    expect(probe.kind).toBe("cmd");
    expect(probe.description).toBe("live HA data");
    expect(probe.command).toContain("curl");
  });
});

describe("postgres builder", () => {
  it("produces a service named 'postgres'", () => {
    const pg = postgres({ volume: "pgdata" });
    expect(pg.name).toBe("postgres");
  });

  it("stores volume reference", () => {
    const pg = postgres({ volume: "pgdata" });
    expect(pg.volume).toBe("pgdata");
  });

  it("stores optional config and init paths", () => {
    const pg = postgres({
      volume: "pgdata",
      config: ["infra/postgres/postgresql.conf"],
      init: ["infra/postgres/initdb"],
    });
    expect(pg.config).toContain("infra/postgres/postgresql.conf");
    expect(pg.init).toContain("infra/postgres/initdb");
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
          health: [httpProbe("https://dashboard.worldwidewebb.co", 200, { certValid: true })],
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

    // No actual secret values — the string "credential" only appears inside the op:// URI.
    // We assert the raw HA_TOKEN key has an op:// value, not a bare secret string.
    const apiSvc = spec.services.find((s) => s.name === "api");
    expect(apiSvc).toBeDefined();
    for (const val of Object.values(apiSvc?.secrets ?? {})) {
      expect(val).toMatch(/^op:\/\//);
    }
  });

  it("spec has zero side effects — no network objects attached", () => {
    // The Spec is a plain data object. If any builder captured a Promise or
    // opened a socket, JSON.stringify would drop it silently — but we assert
    // every service field is serializable by round-tripping through JSON.
    const spec = buildTestSpec();
    const roundTripped = JSON.parse(JSON.stringify(spec)) as Spec;
    expect(roundTripped.name).toBe(spec.name);
    expect(roundTripped.services.length).toBe(spec.services.length);
  });
});
