import { describe, expect, it, vi } from "vitest";
import {
  buildJobCommand,
  cronMatches,
  dueCronJobs,
  jobServiceName,
  runDueJobs,
} from "../src/scheduler.ts";
import type { ServiceSpec, Spec } from "../src/spec.ts";

// Build a Date in local time (the scheduler matches wall-clock, like a host cron
// daemon). Month is 1-based here for readability; the Date ctor takes 0-based.
function at(y: number, mon: number, d: number, h: number, min: number): Date {
  return new Date(y, mon - 1, d, h, min, 0, 0);
}

describe("cronMatches — 5-field cron matching (local wall clock)", () => {
  // 2026-06-04 is a Thursday (dow=4).
  const thu0303 = at(2026, 6, 4, 3, 3);

  it("matches a fully-wildcard expression every minute", () => {
    expect(cronMatches("* * * * *", thu0303)).toBe(true);
  });

  it("matches an exact minute+hour and rejects the surrounding minutes", () => {
    expect(cronMatches("3 3 * * *", thu0303)).toBe(true);
    expect(cronMatches("2 3 * * *", thu0303)).toBe(false);
    expect(cronMatches("3 4 * * *", thu0303)).toBe(false);
  });

  it("matches 0 3 * * * only at the top of hour 3", () => {
    expect(cronMatches("0 3 * * *", at(2026, 6, 4, 3, 0))).toBe(true);
    expect(cronMatches("0 3 * * *", at(2026, 6, 4, 3, 1))).toBe(false);
  });

  it("handles comma lists", () => {
    expect(cronMatches("0,30 * * * *", at(2026, 6, 4, 1, 30))).toBe(true);
    expect(cronMatches("0,30 * * * *", at(2026, 6, 4, 1, 15))).toBe(false);
  });

  it("handles ranges", () => {
    expect(cronMatches("* 9-17 * * *", at(2026, 6, 4, 12, 0))).toBe(true);
    expect(cronMatches("* 9-17 * * *", at(2026, 6, 4, 8, 0))).toBe(false);
    expect(cronMatches("* 9-17 * * *", at(2026, 6, 4, 17, 59))).toBe(true);
  });

  it("handles step values on a wildcard", () => {
    expect(cronMatches("*/15 * * * *", at(2026, 6, 4, 1, 0))).toBe(true);
    expect(cronMatches("*/15 * * * *", at(2026, 6, 4, 1, 15))).toBe(true);
    expect(cronMatches("*/15 * * * *", at(2026, 6, 4, 1, 16))).toBe(false);
  });

  it("handles steps over a range", () => {
    expect(cronMatches("0-30/10 * * * *", at(2026, 6, 4, 1, 20))).toBe(true);
    expect(cronMatches("0-30/10 * * * *", at(2026, 6, 4, 1, 25))).toBe(false);
  });

  it("matches month and day-of-month fields", () => {
    expect(cronMatches("0 0 4 6 *", at(2026, 6, 4, 0, 0))).toBe(true);
    expect(cronMatches("0 0 4 6 *", at(2026, 7, 4, 0, 0))).toBe(false); // wrong month
    expect(cronMatches("0 0 5 6 *", at(2026, 6, 4, 0, 0))).toBe(false); // wrong dom
  });

  it("matches day-of-week (0=Sunday) and accepts 7 as Sunday", () => {
    const sun = at(2026, 6, 7, 9, 0); // 2026-06-07 is a Sunday
    expect(cronMatches("0 9 * * 0", sun)).toBe(true);
    expect(cronMatches("0 9 * * 7", sun)).toBe(true);
    expect(cronMatches("0 9 * * 4", sun)).toBe(false);
  });

  it("uses OR between dom and dow when BOTH are restricted (standard cron rule)", () => {
    // dom=1 OR dow=4(Thu). 2026-06-04 is the 4th AND a Thursday — both match.
    expect(cronMatches("0 0 1 * 4", at(2026, 6, 4, 0, 0))).toBe(true); // dow matches
    expect(cronMatches("0 0 4 * 1", at(2026, 6, 4, 0, 0))).toBe(true); // dom matches
    // Neither: 2026-06-05 is the 5th and a Friday.
    expect(cronMatches("0 0 1 * 4", at(2026, 6, 5, 0, 0))).toBe(false);
  });

  it("uses AND of all fields when dom/dow are not both restricted", () => {
    // Only dom restricted (dow=*): must be the 4th regardless of weekday.
    expect(cronMatches("0 0 4 * *", at(2026, 6, 4, 0, 0))).toBe(true);
    expect(cronMatches("0 0 4 * *", at(2026, 6, 5, 0, 0))).toBe(false);
  });

  it("rejects a malformed expression (not 5 fields)", () => {
    expect(() => cronMatches("* * * *", thu0303)).toThrow(/5-field/);
    expect(() => cronMatches("0 0 3 * * *", thu0303)).toThrow(/5-field/);
  });

  it("rejects out-of-range values", () => {
    expect(() => cronMatches("60 * * * *", thu0303)).toThrow();
    expect(() => cronMatches("* 24 * * *", thu0303)).toThrow();
  });
});

// --- job fixtures ---
function cronService(
  name: string,
  cron: string,
  command: string,
  extra: Partial<ServiceSpec> = {},
): ServiceSpec {
  return {
    name,
    image: "docker:cli",
    secrets: [],
    env: {},
    command,
    schedule: { cron },
    health: [],
    ...extra,
  };
}

const STACK = "control-center";

describe("jobServiceName — config-derived, no magic prefix", () => {
  it("derives the swarm service name from the stack name", () => {
    expect(jobServiceName("control-center", "docker-image-prune")).toBe(
      "control-center-cron-docker-image-prune",
    );
  });
});

describe("buildJobCommand — swarm one-shot (replicated-job) invocation", () => {
  const job = cronService(
    "docker-image-prune",
    "0 3 * * *",
    'docker image prune -a -f --filter "until=720h"',
    {
      volumes: ["/var/run/docker.sock:/var/run/docker.sock"],
      placement: ["node.role==manager"],
    },
  );

  it("removes the prior run's service then creates a replicated-job", () => {
    const cmd = buildJobCommand(job, STACK);
    expect(cmd).toContain(
      "docker service rm control-center-cron-docker-image-prune >/dev/null 2>&1;",
    );
    expect(cmd).toContain("docker service create");
    expect(cmd).toContain("--mode replicated-job");
    expect(cmd).toContain("--restart-condition none");
    expect(cmd).toContain("--name control-center-cron-docker-image-prune");
    // The rm must precede the create.
    expect(cmd.indexOf("service rm")).toBeLessThan(cmd.indexOf("service create"));
  });

  it("passes --with-registry-auth so private GHCR images pull", () => {
    expect(buildJobCommand(job, STACK)).toContain("--with-registry-auth");
  });

  it("labels the job for discovery in Portainer / docker service ls", () => {
    expect(buildJobCommand(job, STACK)).toContain("--label bosun.cron-job=docker-image-prune");
  });

  it("translates a socket bind volume to a swarm --mount", () => {
    expect(buildJobCommand(job, STACK)).toContain(
      "--mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock",
    );
  });

  it("marks a :ro mount readonly", () => {
    const ro = cronService("j", "* * * * *", "x", {
      volumes: ["/var/run/docker.sock:/var/run/docker.sock:ro"],
    });
    expect(buildJobCommand(ro, STACK)).toContain(
      "--mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock,readonly",
    );
  });

  it("renders a named volume as a swarm volume mount", () => {
    const v = cronService("j", "* * * * *", "x", { volumes: ["backups:/data"] });
    expect(buildJobCommand(v, STACK)).toContain("--mount type=volume,source=backups,target=/data");
  });

  it("renders placement constraints", () => {
    expect(buildJobCommand(job, STACK)).toContain("--constraint node.role==manager");
  });

  it("passes non-secret env vars with --env", () => {
    const j = cronService("j", "* * * * *", "echo hi", { env: { FOO: "bar" } });
    expect(buildJobCommand(j, STACK)).toContain("--env FOO=bar");
  });

  it("places the image before the in-container command", () => {
    const cmd = buildJobCommand(job, STACK);
    expect(cmd.indexOf("docker:cli")).toBeLessThan(cmd.indexOf("image prune"));
    expect(cmd).toContain('docker image prune -a -f --filter "until=720h"');
  });
});

describe("dueCronJobs — selecting jobs whose schedule matches a moment", () => {
  const spec: Spec = {
    stackName: "control-center",
    services: [
      { name: "web", image: "x", secrets: [], env: {}, health: [] }, // not a job
      cronService("nightly", "0 3 * * *", "echo nightly"),
      cronService("hourly", "0 * * * *", "echo hourly"),
    ],
  };

  it("returns only schedule-bearing services that match the given minute", () => {
    const due = dueCronJobs(spec.services, at(2026, 6, 4, 3, 0));
    expect(due.map((j) => j.name).sort()).toEqual(["hourly", "nightly"]);
  });

  it("excludes non-job services and jobs that do not match", () => {
    const due = dueCronJobs(spec.services, at(2026, 6, 4, 4, 30));
    expect(due).toEqual([]);
  });
});

describe("runDueJobs — execution with double-run and in-flight guards", () => {
  const jobs: ServiceSpec[] = [cronService("hourly", "0 * * * *", "echo hourly")];
  const state = () => ({ lastRunMinute: new Map<string, string>(), inFlight: new Set<string>() });

  it("runs a job's built command via the injected runner when due", async () => {
    const runner = vi.fn(async (_cmd: string) => ({ exitCode: 0 }));
    await runDueJobs(jobs, at(2026, 6, 4, 3, 0), runner, state(), STACK);
    expect(runner).toHaveBeenCalledOnce();
    expect(runner.mock.calls[0][0]).toContain("control-center-cron-hourly");
  });

  it("does not run the same job twice within the same minute", async () => {
    const runner = vi.fn(async (_cmd: string) => ({ exitCode: 0 }));
    const s = state();
    const now = at(2026, 6, 4, 3, 0);
    await runDueJobs(jobs, now, runner, s, STACK);
    await runDueJobs(jobs, now, runner, s, STACK); // same minute, second tick
    expect(runner).toHaveBeenCalledOnce();
  });

  it("runs again on the next matching minute", async () => {
    const runner = vi.fn(async (_cmd: string) => ({ exitCode: 0 }));
    const s = state();
    await runDueJobs(jobs, at(2026, 6, 4, 3, 0), runner, s, STACK);
    await runDueJobs(jobs, at(2026, 6, 4, 4, 0), runner, s, STACK);
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("skips a job that is still in flight from a prior tick", async () => {
    // A runner that never resolves models a long-running job still executing.
    let resolve: (v: { exitCode: number }) => void = () => {};
    const runner = vi.fn(() => new Promise<{ exitCode: number }>((r) => (resolve = r)));
    const s = state();
    const everyMinute: ServiceSpec[] = [cronService("tight", "* * * * *", "sleep")];
    runDueJobs(everyMinute, at(2026, 6, 4, 3, 0), runner, s, STACK); // starts, stays in flight
    await runDueJobs(everyMinute, at(2026, 6, 4, 3, 1), runner, s, STACK); // next min, still running
    expect(runner).toHaveBeenCalledOnce();
    resolve({ exitCode: 0 });
  });
});
