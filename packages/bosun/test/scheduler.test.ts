import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildJobCommand,
  cronMatches,
  dueCronJobs,
  jobServiceName,
  runDueJobs,
  selectCronJob,
  slotKey,
} from "../src/scheduler.ts";
import type { ServiceSpec, Spec } from "../src/spec.ts";

// Build a Date in local time (the scheduler matches wall-clock, like a host cron
// daemon). Month is 1-based here for readability; the Date ctor takes 0-based.
function at(y: number, mon: number, d: number, h: number, min: number): Date {
  return new Date(y, mon - 1, d, h, min, 0, 0);
}

describe("cronMatches, 5-field cron matching (local wall clock)", () => {
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
    // dom=1 OR dow=4(Thu). 2026-06-04 is the 4th AND a Thursday, both match.
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

// www-dd0: the scheduler matches cron against the container's LOCAL wall clock
// (getHours/getDate, not the UTC accessors), so the container TZ decides when a
// job fires. The agent image bakes TZ=America/Los_Angeles, so `0 3 * * *` must
// fire at 03:00 LA, NOT 03:00 UTC (which is ~8pm LA, on-peak, the bug).
//
// These tests pin TZ around a fixed UTC instant and assert the LA interpretation
// matches while the UTC one does not. Bun re-reads process.env.TZ per Date
// construction, so stubbing it is a faithful stand-in for the container's TZ.
describe("cronMatches, interprets the wall clock in the container TZ (www-dd0)", () => {
  // 2026-06-04T10:00:00Z. In LA (PDT, UTC-7 in June) that is 03:00 local.
  const utcInstant = new Date(Date.UTC(2026, 5, 4, 10, 0, 0));

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fires the nightly 03:00 prune at 03:00 LA, not 03:00 UTC", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    // 10:00 UTC == 03:00 PDT: the LA-local 03:00 slot matches.
    expect(cronMatches("0 3 * * *", utcInstant)).toBe(true);

    vi.stubEnv("TZ", "UTC");
    // Same instant read as UTC is 10:00, so the 03:00 slot does NOT match ,
    // this is exactly the pre-fix behaviour the LA container TZ corrects.
    expect(cronMatches("0 3 * * *", utcInstant)).toBe(false);
    // Under UTC the instant is the 10:00 slot instead.
    expect(cronMatches("0 10 * * *", utcInstant)).toBe(true);
  });

  it("DST shifts the UTC offset automatically via the IANA zone (winter case)", () => {
    // 2026-01-15T11:00:00Z. In LA (PST, UTC-8 in January) that is 03:00 local.
    const winter = new Date(Date.UTC(2026, 0, 15, 11, 0, 0));
    vi.stubEnv("TZ", "America/Los_Angeles");
    expect(cronMatches("0 3 * * *", winter)).toBe(true);
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

describe("jobServiceName, config-derived, no magic prefix", () => {
  it("derives the swarm service name from the stack name", () => {
    expect(jobServiceName("control-center", "docker-image-prune")).toBe(
      "control-center-cron-docker-image-prune",
    );
  });
});

describe("selectCronJob, on-demand trigger selection (`bosun run-job`)", () => {
  const prune = cronService("docker-image-prune", "0 3 * * *", "docker image prune -af");
  const backup = cronService("db-backup", "30 2 * * *", "pg_dump ...");
  // A long-lived service (no schedule) is NOT a cron job and must be rejected.
  const web: ServiceSpec = {
    name: "web",
    image: "nginx",
    secrets: [],
    env: {},
    health: [],
  };
  const services = [web, prune, backup];

  it("returns the schedule-bearing service matching the name", () => {
    expect(selectCronJob(services, "docker-image-prune")).toBe(prune);
    expect(selectCronJob(services, "db-backup")).toBe(backup);
  });

  it("throws a clear error naming the unknown job and listing the real ones", () => {
    expect(() => selectCronJob(services, "nope")).toThrowError(
      /unknown cron job 'nope'.*docker-image-prune.*db-backup/s,
    );
  });

  it("rejects a real service that is not a cron job (has no schedule)", () => {
    expect(() => selectCronJob(services, "web")).toThrowError(/'web' is not a cron job/);
  });
});

describe("buildJobCommand, swarm one-shot (replicated-job) invocation", () => {
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

  it("stamps the slot label when a slot is given (restart-safe dedupe key)", () => {
    const cmd = buildJobCommand(job, STACK, "2026-5-4T3:0");
    expect(cmd).toContain("--label bosun.cron-slot=2026-5-4T3:0");
  });

  it("omits the slot label for a manual run (no slot, `run-job`)", () => {
    expect(buildJobCommand(job, STACK)).not.toContain("bosun.cron-slot");
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

  it("renders a named volume as a swarm volume mount, stack-namespaced", () => {
    // A named volume in the deployed stack is `<stack>_<name>`; a cron job runs
    // outside the stack and MUST use the same prefix or it mounts a different
    // volume than the service it shares (www-q002.22).
    const v = cronService("j", "* * * * *", "x", { volumes: ["backups:/data"] });
    expect(buildJobCommand(v, STACK)).toContain(
      "--mount type=volume,source=control-center_backups,target=/data",
    );
  });

  it("namespaces a shared named volume so the job + service mount the SAME volume (www-q002.22 regression)", () => {
    // The portal-cert-renew acme job and the captive-portal service both declare
    // `portal-certs:/certs`. The service (stack-deployed) gets
    // `control-center_portal-certs`; the job must too, or the issued cert lands
    // in an orphan `portal-certs` the portal never reads.
    const certJob = cronService("portal-cert-renew", "0 4 * * *", "--issue", {
      volumes: ["portal-certs:/certs"],
    });
    const cmd = buildJobCommand(certJob, STACK);
    expect(cmd).toContain("--mount type=volume,source=control-center_portal-certs,target=/certs");
    expect(cmd).not.toContain("source=portal-certs,");
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

  // www-q002.13: a cron job may need op-resolved secrets (the cert job needs the
  // Cloudflare API token). The bosun agent resolves the refs and passes the values
  // in as resolvedSecrets; buildJobCommand appends them as --env at create time.
  // buildJobCommand stays PURE, it takes already-resolved values, never resolves.
  describe("resolved secrets (www-q002.13)", () => {
    it("appends each resolved secret as --env after the static env", () => {
      const j = cronService("cert", "0 4 * * *", "acme.sh --issue", { env: { FOO: "bar" } });
      const cmd = buildJobCommand(j, STACK, undefined, { CF_Token: "tok-abc", ANOTHER: "v2" });
      expect(cmd).toContain("--env FOO=bar");
      expect(cmd).toContain("--env CF_Token=tok-abc");
      expect(cmd).toContain("--env ANOTHER=v2");
    });

    it("sorts resolved secret env keys for deterministic output", () => {
      const j = cronService("cert", "0 4 * * *", "x");
      const cmd = buildJobCommand(j, STACK, undefined, { ZED: "z", ABLE: "a" });
      expect(cmd.indexOf("--env ABLE=a")).toBeLessThan(cmd.indexOf("--env ZED=z"));
    });

    it("emits no secret env when no resolved secrets are passed (run-job / no-secret job)", () => {
      const j = cronService("cert", "0 4 * * *", "x");
      expect(buildJobCommand(j, STACK)).not.toContain("CF_Token");
    });
  });
});

describe("dueCronJobs, selecting jobs whose schedule matches a moment", () => {
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

describe("slotKey, per-minute slot identity (restart-safe dedupe key)", () => {
  it("is stable within a minute and distinct across minutes", () => {
    expect(slotKey(at(2026, 6, 4, 3, 0))).toBe(slotKey(at(2026, 6, 4, 3, 0)));
    expect(slotKey(at(2026, 6, 4, 3, 0))).not.toBe(slotKey(at(2026, 6, 4, 3, 1)));
  });
});

describe("runDueJobs, guards derived from swarm (restart-safe)", () => {
  const jobs: ServiceSpec[] = [cronService("hourly", "0 * * * *", "echo hourly")];
  // A JobInspector stub returning a fixed swarm view for the job service.
  const inspector = (view: { slot: string | null; inFlight: boolean }) =>
    vi.fn(async (_svc: string) => view);

  it("fires (rm+create) when swarm shows no prior slot and nothing in flight", async () => {
    const runner = vi.fn(async (_cmd: string) => ({ exitCode: 0 }));
    await runDueJobs(
      jobs,
      at(2026, 6, 4, 3, 0),
      runner,
      inspector({ slot: null, inFlight: false }),
      STACK,
    );
    expect(runner).toHaveBeenCalledOnce();
    expect(runner.mock.calls[0][0]).toContain("control-center-cron-hourly");
    // The fired command stamps THIS slot so a restart can recognise it.
    expect(runner.mock.calls[0][0]).toContain(
      `--label bosun.cron-slot=${slotKey(at(2026, 6, 4, 3, 0))}`,
    );
  });

  it("does NOT re-fire a slot already stamped on the service, even with fresh in-memory state (restart safety)", async () => {
    const runner = vi.fn(async (_cmd: string) => ({ exitCode: 0 }));
    const now = at(2026, 6, 4, 3, 0);
    // Simulates a just-restarted scheduler: no memory, but swarm shows the
    // service already carries this slot's label.
    await runDueJobs(jobs, now, runner, inspector({ slot: slotKey(now), inFlight: false }), STACK);
    expect(runner).not.toHaveBeenCalled();
  });

  it("skips when a task is still in flight (long run spanning a restart)", async () => {
    const runner = vi.fn(async (_cmd: string) => ({ exitCode: 0 }));
    // Prior slot ran; its task is still executing when this slot comes due.
    await runDueJobs(
      jobs,
      at(2026, 6, 4, 4, 0),
      runner,
      inspector({ slot: slotKey(at(2026, 6, 4, 3, 0)), inFlight: true }),
      STACK,
    );
    expect(runner).not.toHaveBeenCalled();
  });

  it("runs again on the next matching minute once the prior slot is terminal", async () => {
    const runner = vi.fn(async (_cmd: string) => ({ exitCode: 0 }));
    // New slot, prior run complete (different slot label, nothing in flight).
    await runDueJobs(
      jobs,
      at(2026, 6, 4, 4, 0),
      runner,
      inspector({ slot: slotKey(at(2026, 6, 4, 3, 0)), inFlight: false }),
      STACK,
    );
    expect(runner).toHaveBeenCalledOnce();
  });

  it("skips the tick (does not fire blindly) when the inspector errors", async () => {
    const runner = vi.fn(async (_cmd: string) => ({ exitCode: 0 }));
    const failing = vi.fn(async (_svc: string) => {
      throw new Error("docker unreachable");
    });
    await runDueJobs(jobs, at(2026, 6, 4, 3, 0), runner, failing, STACK);
    expect(runner).not.toHaveBeenCalled();
  });
});

// www-q002.13: a cron job declaring op-resolved secrets has them resolved by the
// injected resolver right before dispatch and injected as --env on the swarm job.
// The resolved VALUE must never reach the logs (only the ref path / job name may).
describe("runDueJobs, op-resolved secrets injection (www-q002.13)", () => {
  const at0 = at(2026, 6, 4, 3, 0);
  const inspector = vi.fn(async (_svc: string) => ({ slot: null, inFlight: false }));
  const certJob = (): ServiceSpec =>
    cronService("cert", "0 * * * *", "acme.sh --issue", {
      secrets: [{ name: "CF_Token", ref: "op://Homelab/Cloudflare API/credential" }],
    });

  it("resolves the job's secret refs and injects them as --env on the dispatched job", async () => {
    const runner = vi.fn(async (_cmd: string) => ({ exitCode: 0 }));
    const resolve = vi.fn(async (_ref: string) => "SECRET-VALUE-XYZ");
    await runDueJobs([certJob()], at0, runner, inspector, STACK, undefined, resolve);
    expect(resolve).toHaveBeenCalledWith("op://Homelab/Cloudflare API/credential");
    expect(runner).toHaveBeenCalledOnce();
    expect(runner.mock.calls[0][0]).toContain("--env CF_Token=SECRET-VALUE-XYZ");
  });

  it("never writes the resolved secret value to any log line", async () => {
    const logged: string[] = [];
    // Capture every structured log field value as a string so we can assert the
    // secret value appears in NONE of them.
    const capturing = {
      debug: (o: unknown, m?: string) => logged.push(JSON.stringify(o), m ?? ""),
      info: (o: unknown, m?: string) => logged.push(JSON.stringify(o), m ?? ""),
      warn: (o: unknown, m?: string) => logged.push(JSON.stringify(o), m ?? ""),
      error: (o: unknown, m?: string) => logged.push(JSON.stringify(o), m ?? ""),
      child() {
        return this;
      },
    } as unknown as import("@repo/logger").Logger;
    const runner = vi.fn(async (_cmd: string) => ({ exitCode: 0 }));
    const resolve = vi.fn(async (_ref: string) => "SECRET-VALUE-XYZ");
    await runDueJobs([certJob()], at0, runner, inspector, STACK, capturing, resolve);
    expect(runner).toHaveBeenCalledOnce();
    // The value reached the command (so it WAS used)...
    expect(runner.mock.calls[0][0]).toContain("SECRET-VALUE-XYZ");
    // ...but never any log line.
    expect(logged.join("\n")).not.toContain("SECRET-VALUE-XYZ");
  });

  it("skips a job that declares secrets when no resolver is supplied (never fires without its secrets)", async () => {
    const runner = vi.fn(async (_cmd: string) => ({ exitCode: 0 }));
    // No resolver passed, a secret-bearing job must NOT fire blind.
    await runDueJobs([certJob()], at0, runner, inspector, STACK);
    expect(runner).not.toHaveBeenCalled();
  });

  it("still fires a no-secret job when no resolver is supplied (back-compat)", async () => {
    const runner = vi.fn(async (_cmd: string) => ({ exitCode: 0 }));
    await runDueJobs([cronService("plain", "0 * * * *", "echo hi")], at0, runner, inspector, STACK);
    expect(runner).toHaveBeenCalledOnce();
  });
});
