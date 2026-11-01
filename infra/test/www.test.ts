import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { renderWorkload } from "../src/component";
import { serviceSpecs } from "../src/services";

const opts = { cloudflaredReplicas: 2, nasNfsServer: "192.168.0.218" };
const digest = `sha256:${"a".repeat(64)}`;
describe("www consolidation", () => {
  it("clears the live rollingUpdate before previewing the Recreate migration", () => {
    const workflow = parse(
      readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8"),
    );
    const deployStep = workflow.jobs["deploy-home-server"].steps.find((step: { run?: string }) =>
      step.run?.includes('bash ../scripts/deploy-www.sh "$STACK"'),
    );
    expect(deployStep).toBeDefined();
    const deploy = readFileSync(new URL("../../scripts/deploy-www.sh", import.meta.url), "utf8");
    const patch = deploy.match(
      /kubectl -n control-center patch deployment api --type=merge \\\n\s+-p '([^']+)'/,
    );
    expect(patch).not.toBeNull();
    expect(JSON.parse(patch?.[1] ?? "{}")).toEqual({
      spec: { strategy: { type: "Recreate", rollingUpdate: null } },
    });
    const preview = deploy.indexOf('pulumi preview --stack "$stack"');
    const stopWorker = deploy.indexOf("scale deployment worker --replicas=0");
    expect(patch?.index).toBeLessThan(preview);
    expect(preview).toBeLessThan(stopWorker);
    expect(stopWorker).toBeLessThan(deploy.indexOf('pulumi up --yes --stack "$stack"'));
  });
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
