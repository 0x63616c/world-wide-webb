import { describe, expect, test } from "vitest";
import type { CronJobSpec } from "../src/component.ts";
import { renderCronJob } from "../src/component.ts";

// The cronJob() half of the vocabulary: a scheduled one-shot Job. Same
// pure-mapping discipline as renderWorkload - declaration -> a k8s CronJob arg object.

const backup: CronJobSpec = {
  name: "pg-backup",
  image: "ghcr.io/0x63616c/www-control-center-api:main",
  schedule: "0 2 * * *",
  command: ["bash", "-c", "pg_dump"],
  secrets: [{ name: "POSTGRES_PASSWORD", ref: "test-secret-ref" }],
  env: { TZ: "America/Los_Angeles" },
};

describe("renderCronJob", () => {
  test("emits a CronJob on the declared schedule", () => {
    const c = renderCronJob(backup);
    expect(c.cronJob.spec.schedule).toBe("0 2 * * *");
  });

  test("runs the job once and never restarts a failed run (one-shot semantics)", () => {
    const c = renderCronJob(backup);
    const jobPod = c.cronJob.spec.jobTemplate.spec.template.spec;
    expect(jobPod.restartPolicy).toBe("Never");
    // No overlapping runs.
    expect(c.cronJob.spec.concurrencyPolicy).toBe("Forbid");
  });

  test("carries the command override and plain env, secrets as a /run/secrets file mount", () => {
    const c = renderCronJob(backup);
    const container = c.cronJob.spec.jobTemplate.spec.template.spec.containers[0];
    expect(container.command).toEqual(["bash", "-c", "pg_dump"]);
    expect(container.env.map((e: { name: string }) => e.name)).toContain("TZ");
    const mount = container.volumeMounts.find((m) => m.mountPath === "/run/secrets");
    expect(mount).toBeDefined();
  });

  test("a manual-only job can be suspended (driven by `kubectl create job` instead)", () => {
    const manualOnly: CronJobSpec = { ...backup, name: "manual-only", suspend: true };
    expect(renderCronJob(manualOnly).cronJob.spec.suspend).toBe(true);
  });
});
