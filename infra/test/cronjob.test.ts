import { describe, expect, test } from "vitest";
import type { CronJobSpec } from "../src/component.ts";
import { renderCronJob } from "../src/component.ts";

// The cronJob() half of the vocabulary: a scheduled one-shot Job. Same
// pure-mapping discipline as renderWorkload - declaration -> a k8s CronJob arg object.

const purge: CronJobSpec = {
  name: "portal-data-purge",
  image: "ghcr.io/0x63616c/www-cc-api:main",
  schedule: "0 2 * * *",
  command: ["bun", "purge.js"],
  secrets: [{ name: "POSTGRES_PASSWORD", ref: "test-secret-ref" }],
  env: { TZ: "America/Los_Angeles" },
};

describe("renderCronJob", () => {
  test("emits a CronJob on the declared schedule", () => {
    const c = renderCronJob(purge);
    expect(c.cronJob.spec.schedule).toBe("0 2 * * *");
  });

  test("runs the job once and never restarts a failed run (one-shot semantics)", () => {
    const c = renderCronJob(purge);
    const jobPod = c.cronJob.spec.jobTemplate.spec.template.spec;
    expect(jobPod.restartPolicy).toBe("Never");
    // No overlapping runs.
    expect(c.cronJob.spec.concurrencyPolicy).toBe("Forbid");
  });

  test("carries the command override and plain env, secrets as a /run/secrets file mount", () => {
    const c = renderCronJob(purge);
    const container = c.cronJob.spec.jobTemplate.spec.template.spec.containers[0];
    expect(container.command).toEqual(["bun", "purge.js"]);
    expect(container.env.map((e: { name: string }) => e.name)).toContain("TZ");
    const mount = container.volumeMounts.find((m) => m.mountPath === "/run/secrets");
    expect(mount).toBeDefined();
  });

  test("a manual-only job can be suspended (map-extract is driven by kubectl create job)", () => {
    const mapExtract: CronJobSpec = {
      name: "map-extract",
      image: "ghcr.io/protomaps/go-pmtiles:v1.30.3",
      schedule: "0 5 1 1 *",
      command: ["extract", "https://build.protomaps.com/x.pmtiles", "/out/socal.pmtiles"],
      suspend: true,
    };
    expect(renderCronJob(mapExtract).cronJob.spec.suspend).toBe(true);
  });
});
