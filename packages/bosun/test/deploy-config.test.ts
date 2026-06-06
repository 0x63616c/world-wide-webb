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

  it("shares the api image and selects the worker entrypoint via command", () => {
    // Same image as the api so no separate CI build is needed: the api path
    // filter rebuilds control-center-api and bosun's pinImage rolls every
    // service on that image (api + worker) to the new digest together.
    expect(worker.image).toBe(api.image);
    expect(worker.image).toContain("control-center-api");
    expect(worker.command).toBe("bun run worker");
  });

  it("serves no traffic — no route, no port, no health probes", () => {
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
    // Secrets/env stay in lockstep with the api so the two never drift.
    const names = (s: ServiceSpec) => s.secrets.map((x) => x.name).sort();
    expect(names(worker)).toEqual(names(api));
    expect(Object.keys(worker.env).sort()).toEqual(Object.keys(api.env).sort());
  });
});

describe("deploy.config.ts postgres (CC-355t.4)", () => {
  const pg = svc("postgres");

  it("mounts only the data volume — no unsupported config/init mounts", () => {
    // The removed config/init options were never rendered or mounted; assert the
    // postgres service mounts exactly its data volume so a re-added bogus mount
    // (referencing the nonexistent infra/ tree) is caught.
    expect(pg.volumes).toEqual(["pgdata:/var/lib/postgresql/data"]);
  });
});
