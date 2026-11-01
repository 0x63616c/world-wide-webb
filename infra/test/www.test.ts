import { describe, expect, it } from "vitest";
import { renderWorkload } from "../src/component";
import { serviceSpecs } from "../src/services";

const opts = { cloudflaredReplicas: 2, nasNfsServer: "192.168.0.218" };
const digest = `sha256:${"a".repeat(64)}`;
describe("www consolidation", () => {
  it("keeps old deployments and routes existing origins to one process", () => {
    const specs = serviceSpecs({ ...opts, imageDigests: { "control-center-www": digest } });
    const api = specs.find((s) => s.name === "api");
    if (!api) throw new Error("Missing api workload");
    expect(api.image).toBe(`ghcr.io/0x63616c/www-control-center-www@${digest}`);
    expect(api.env?.WORKER_CYCLES).toBe("on");
    expect(renderWorkload(api).deployment.spec.strategy?.type).toBe("Recreate");
    for (const name of ["worker", "web", "manage"]) {
      const legacy = specs.find((s) => s.name === name);
      if (!legacy) throw new Error(`Missing ${name} workload`);
      expect(legacy.replicas).toBe(0);
      if (name === "worker") continue;
      const svc = renderWorkload(legacy).services[0].spec;
      expect(svc.selector).toEqual({ app: "api" });
      expect(svc.ports[0]).toMatchObject({ port: 80, targetPort: 4201 });
    }
  });
  it("rejects a malformed www digest before rendering workloads", () => {
    expect(() => serviceSpecs({ ...opts, imageDigests: { "control-center-www": "main" } })).toThrow(
      /sha256/,
    );
  });
  it("restores the legacy deployment when the www pin is removed", () => {
    const specs = serviceSpecs(opts);
    for (const name of ["api", "worker", "web", "manage"]) {
      const legacy = specs.find((s) => s.name === name);
      if (!legacy) throw new Error(`Missing ${name} workload`);
      expect(legacy.replicas).toBe(1);
      expect(legacy.serviceTarget).toBeUndefined();
    }
  });
});
