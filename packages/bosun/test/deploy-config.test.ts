import { describe, expect, it } from "vitest";
import deploySpec from "../../../deploy.config.ts";
import type { ServiceSpec } from "../src/spec.ts";

// Guards the real deployment manifest (root deploy.config.ts), not just the
// builders. The manifest is prod-critical: `bosun up` renders the whole stack
// from it, so a silent regression here breaks production.

const svc = (name: string): ServiceSpec => {
  const s = deploySpec.services.find((x) => x.name === name);
  if (!s) throw new Error(`service '${name}' not found in deploy.config.ts`);
  return s;
};

describe("deploy.config.ts web TLS probe (CC-355t.3)", () => {
  const web = svc("web");

  it("validates the dashboard cert via a certProbe (openssl -checkend)", () => {
    // The intent of the old `httpProbe(url, 200, { certValid: true })` form was
    // cert validation, but httpProbe takes only (url, status) so the 3rd arg was
    // silently dropped and NO cert check ran. It is now an explicit certProbe.
    const cert = web.health.find(
      (h) => h.kind === "cmd" && h.command?.includes("openssl") && h.command?.includes("-checkend"),
    );
    expect(cert).toBeDefined();
    expect(cert?.command).toContain("-servername dashboard.worldwidewebb.co");
  });

  it("still keeps the http-200 probe and the pmtiles probe (nothing dropped)", () => {
    expect(web.health.some((h) => h.kind === "http" && h.expectedStatus === 200)).toBe(true);
    expect(web.health.some((h) => h.command?.includes("PMTiles"))).toBe(true);
  });

  it("passes no silently-ignored positional args to httpProbe", () => {
    // Every http probe carries exactly the two fields httpProbe sets; a 3rd
    // option arg (like the dropped { certValid }) would never reach the spec.
    for (const h of web.health.filter((p) => p.kind === "http")) {
      expect(h.url).toBeTruthy();
      expect(typeof h.expectedStatus).toBe("number");
    }
  });
});

describe("deploy.config.ts worker service (CC-7d5b.1.3)", () => {
  const worker = svc("worker");
  const api = svc("api");

  it("has its own image, independent of the api (CC-xjba)", () => {
    // The worker is its own app + image now (apps/worker → control-center-worker),
    // not a command override on the api image. CI's build-worker job + worker path
    // filter rebuild it and bosun's pinImage rolls it independently of the api.
    expect(worker.image).toContain("control-center-worker");
    expect(worker.image).not.toBe(api.image);
    // The worker image's CMD is `bun worker.js` (apps/worker/Dockerfile), so the
    // service needs no command override.
    expect(worker.command).toBeUndefined();
  });

  it("serves no traffic, no route, no port, no health probes", () => {
    // It only reaches out to HA + Postgres over the overlay network; nothing
    // connects to it, so a route/port/probe would be meaningless.
    expect(worker.route).toBeUndefined();
    expect(worker.port).toBeUndefined();
    expect(worker.health).toEqual([]);
    expect(worker.healthcheck).toBeUndefined();
  });

  it("runs in Pacific time and mirrors the api's secret + env names", () => {
    // weather-ingest parses Open-Meteo's timezone=auto LA-local timestamps, so
    // the worker must run in the same TZ as the api did.
    expect(worker.env.TZ).toBe("America/Los_Angeles");
    expect(worker.env.NODE_ENV).toBe("production");
    // Secrets/env stay in lockstep with the api so the two never drift, EXCEPT
    // for secrets only the api needs. The captive-portal email sender (RESEND_*,
    // CC-q002.11) runs in the request-handling api only; the worker never sends
    // portal email, so those are intentionally api-only and excluded here.
    const API_ONLY_SECRETS = new Set(["RESEND_API_KEY", "RESEND_FROM"]);
    const names = (s: ServiceSpec, exclude: Set<string> = new Set()) =>
      s.secrets
        .map((x) => x.name)
        .filter((n) => !exclude.has(n))
        .sort();
    expect(names(worker)).toEqual(names(api, API_ONLY_SECRETS));
    expect(Object.keys(worker.env).sort()).toEqual(Object.keys(api.env).sort());
  });
});

describe("deploy.config.ts captive-portal service (CC-q002.14)", () => {
  const portal = svc("captive-portal");

  it("uses its own nginx image, independent of web/api", () => {
    expect(portal.image).toContain("control-center-captive-portal");
  });

  it("is LAN-only: publishes host 443 and declares NO tunnel route", () => {
    // publishPort binds the Mini's LAN IP (mode: host); the absence of `route`
    // means bosun never creates a Cloudflare tunnel ingress/DNS for it, the
    // service is reachable ONLY on the local network (CC-q002.12).
    expect(portal.publishPort).toEqual({ host: 443, container: 443 });
    expect(portal.route).toBeUndefined();
  });

  it("is pinned to the manager (holds the LAN IP + the cert volume)", () => {
    expect(portal.placement).toContain("node.role==manager");
  });

  it("has a hard memory cap (static nginx)", () => {
    expect(portal.resources?.memory).toBeTruthy();
  });

  it("mounts the shared cert volume read-write so the entrypoint can seed a placeholder", () => {
    // On a FRESH deploy the volume is empty and the entrypoint must WRITE a
    // self-signed placeholder cert so nginx starts before acme issues the real
    // one; a ro mount crash-loops the service (CC-q002.14). The entrypoint's
    // `[ ! -s fullchain ]` guard never overwrites an existing cert, so sharing
    // rw with the acme cron writer is safe.
    expect(portal.volumes).toContain("portal-certs:/certs");
    expect(portal.volumes).not.toContain("portal-certs:/certs:ro");
  });

  it("verifies liveness over the overlay http port, not the public TLS host yet", () => {
    // The container keeps :80 listening for the swarm healthcheck + verify probe.
    // The public-hostname certProbe is added in CC-q002.15 alongside the UniFi
    // local DNS record (until then the agent can't resolve the LAN-only host).
    expect(portal.healthcheck).toBeDefined();
    expect(portal.health.some((h) => h.kind === "http")).toBe(true);
    expect(portal.health.some((h) => h.command?.includes("captive-portal.worldwidewebb.co"))).toBe(
      false,
    );
  });
});

describe("deploy.config.ts captive-portal cert job (CC-q002.13/.14)", () => {
  const cert = svc("portal-cert-renew");

  it("is a cronJob (run by the bosun scheduler, not a long-lived service)", () => {
    expect(cert.schedule?.cron).toBeTruthy();
  });

  it("resolves the Cloudflare API token via op for DNS-01 (never hardcoded)", () => {
    const ref = cert.secrets.find((r) => r.name === "CF_Token");
    expect(ref?.ref).toBe("op://Homelab/Cloudflare API/credential");
  });

  it("writes into the shared cert volume read-write (the portal reads it ro)", () => {
    expect(cert.volumes?.some((v) => v.startsWith("portal-certs:"))).toBe(true);
    // Must NOT be the read-only mount, the job is the writer.
    expect(cert.volumes).not.toContain("portal-certs:/certs:ro");
  });

  it("runs on the manager (same node as the portal + its volume)", () => {
    expect(cert.placement).toContain("node.role==manager");
  });

  it("issues for the portal host via Cloudflare DNS-01", () => {
    expect(cert.command).toContain("captive-portal.worldwidewebb.co");
    expect(cert.command).toContain("dns_cf");
  });
});

describe("deploy.config.ts captive-portal data-purge job (CC-q002.18)", () => {
  const purge = svc("portal-data-purge");

  it("is a cronJob run daily at 02:00 (not a worker loop, not a long-lived service)", () => {
    expect(purge.schedule?.cron).toBe("0 2 * * *");
  });

  it("runs the api image's purge entrypoint via command override", () => {
    expect(purge.command).toBe("bun purge.js");
  });

  it("resolves ONLY the Postgres password via op (env.ts builds DATABASE_URL from it)", () => {
    const names = purge.secrets.map((r) => r.name);
    expect(names).toEqual(["POSTGRES_PASSWORD"]);
    const ref = purge.secrets.find((r) => r.name === "POSTGRES_PASSWORD");
    expect(ref?.ref).toBe("op://Homelab/Control Center Postgres/password");
  });

  it("runs in Pacific time (matches the api/worker)", () => {
    expect(purge.env.TZ).toBe("America/Los_Angeles");
  });
});

describe("deploy.config.ts bosun-agent Cloudflare creds (CC-vqyv)", () => {
  const agent = svc("bosun-agent");

  it("sources CF_ACCOUNT_ID, CF_ZONE_ID and CF_TUNNEL_ID via fromOp so the agent reconciles routes+DNS", () => {
    // These non-secret identifiers ride the docker-secret channel as the wiring
    // that reaches the agent's env without hardcoding them in this PUBLIC repo.
    // The entrypoint exports each /run/secrets/<name> to env; cli.ts reads them.
    const byName = Object.fromEntries(agent.secrets.map((s) => [s.name, s.ref]));
    expect(byName.CF_ACCOUNT_ID).toBe("op://Homelab/Cloudflare API/account_id");
    expect(byName.CF_ZONE_ID).toBe("op://Homelab/Cloudflare API/zone_id");
    expect(byName.CF_TUNNEL_ID).toBe("op://Homelab/Cloudflare API/tunnel_id");
  });

  it("does NOT hardcode the account/tunnel/zone identifiers anywhere in the spec", () => {
    // A literal id in the public repo is the regression this guards. Identifiers
    // must only ever appear as op:// refs (above), never as inline values.
    const serialized = JSON.stringify(deploySpec);
    expect(serialized).not.toContain("633999e9-ec81-478b-b8af-2213778b9441"); // tunnel
    expect(serialized).not.toContain("eb3ea2e5ef93e58704d39980583fee38"); // account
    expect(serialized).not.toContain("04fd68aa9ef098c4f1916f1f7ca271a5"); // zone
  });
});

describe("deploy.config.ts postgres (CC-355t.4)", () => {
  const pg = svc("postgres");

  it("mounts only the data volume, no unsupported config/init mounts", () => {
    // The removed config/init options were never rendered or mounted; assert the
    // postgres service mounts exactly its data volume so a re-added bogus mount
    // (referencing the nonexistent infra/ tree) is caught.
    expect(pg.volumes).toEqual(["pgdata:/var/lib/postgresql/data"]);
  });
});

describe("deploy.config.ts drizzle gateway (CC-0ub8)", () => {
  const drizzle = svc("drizzle");

  it("runs the wrapped gateway image, NOT the raw upstream (so the MASTERPASS file→env preload is baked in)", () => {
    // The upstream gateway is distroless and wants MASTERPASS as an env var, but
    // bosun only delivers secrets as files. We wrap it (apps/drizzle/Dockerfile)
    // with a bun --preload that loads /run/secrets/MASTERPASS into env, so the
    // deployed image must be our own control-center-drizzle, never the raw
    // ghcr.io/drizzle-team/gateway (which would boot with no admin gate).
    expect(drizzle.image).toContain("control-center-drizzle");
    expect(drizzle.image).not.toContain("drizzle-team/gateway");
  });

  it("is publicly routed on the gateway's 4983 port", () => {
    expect(drizzle.route).toBe("drizzle.worldwidewebb.co");
    expect(drizzle.port).toBe(4983);
  });

  it("reuses the existing op://Homelab/Drizzle Gateway/masterpass secret as MASTERPASS", () => {
    // The secret already exists (evee created it in the shared Homelab vault);
    // no new 1Password item. It must mount as MASTERPASS so the preload finds it.
    const ms = drizzle.secrets.find((s) => s.name === "MASTERPASS");
    expect(ms?.ref).toBe("op://Homelab/Drizzle Gateway/masterpass");
  });

  it("persists its config on a node-local named volume pinned to the manager", () => {
    // The gateway stores DB connections + sessions under STORE_PATH=/app; without
    // a volume every redeploy wipes the connection. The volume is node-local, so
    // pin to the manager (same constraint web/postgres use).
    expect(drizzle.volumes).toEqual(["drizzle-data:/app"]);
    expect(drizzle.placement).toContain("node.role==manager");
  });

  it("mounts POSTGRES_PASSWORD so the preload can seed DATABASE_URL_control_center (CC-my5j)", () => {
    // The gateway auto-seeds a connection from any DATABASE_URL_<name> env var on
    // a fresh store; the preload builds DATABASE_URL_control_center from the
    // mounted password file so a clean redeploy auto-connects with no UI step.
    const pw = drizzle.secrets.find((s) => s.name === "POSTGRES_PASSWORD");
    expect(pw?.ref).toBe("op://Homelab/Control Center Postgres/password");
  });
});
