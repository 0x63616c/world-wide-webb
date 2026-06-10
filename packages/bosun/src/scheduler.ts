// bosun-native cron scheduler. Runs entirely inside the long-lived `bosun serve`
// agent (manager node, docker socket) — no third-party scheduler container and
// no deploy labels. Jobs are declared with cronJob() in the spec; this module
// matches their 5-field cron against the wall clock each minute and executes the
// due ones via the docker socket the agent already holds.
//
// Everything here is pure or dependency-injected (clock + runner) so the
// matching, selection, command-building, and guard logic are unit-testable
// without real timers or a real docker daemon — mirroring health.ts.

import type { Logger } from "@repo/logger";
import type { Runner } from "./health.ts";
import type { ServiceSpec } from "./spec.ts";

// Valid value range per cron field (inclusive). dow allows 7 as an alias for
// Sunday (0), normalized in matchField.
const FIELD_RANGES: Array<{ min: number; max: number }> = [
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // day-of-month
  { min: 1, max: 12 }, // month
  { min: 0, max: 7 }, // day-of-week (0 and 7 both = Sunday)
];

// Expand one cron field ("*", "5", "1-5", "*/15", "0-30/10", "1,15,30") into the
// concrete set of values it matches, validating against the field's range.
function expandField(field: string, idx: number): Set<number> {
  const { min, max } = FIELD_RANGES[idx];
  const values = new Set<number>();

  for (const part of field.split(",")) {
    // Optional step: "<range>/<step>".
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) {
      throw new Error(`cron: invalid step '${stepPart}' in field '${field}'`);
    }

    let lo: number;
    let hi: number;
    if (rangePart === "*") {
      lo = min;
      hi = max;
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-").map(Number);
      lo = a;
      hi = b;
    } else {
      lo = Number(rangePart);
      hi = lo;
    }

    if (!Number.isInteger(lo) || !Number.isInteger(hi)) {
      throw new Error(`cron: non-numeric value in field '${field}'`);
    }
    if (lo < min || hi > max || lo > hi) {
      throw new Error(`cron: value out of range [${min}-${max}] in field '${field}'`);
    }

    for (let v = lo; v <= hi; v += step) values.add(v);
  }

  return values;
}

interface ParsedCron {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  // Standard cron rule: when BOTH day-of-month and day-of-week are restricted
  // (neither is "*"), a match on EITHER is sufficient. Track restriction here so
  // cronMatches can apply OR vs AND correctly.
  domRestricted: boolean;
  dowRestricted: boolean;
}

function parseCron(expr: string): ParsedCron {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`cron: expected 5-field expression, got '${expr}'`);
  }
  const dow = expandField(fields[4], 4);
  // Normalize 7 -> 0 (both mean Sunday) so getDay() (0-6) comparisons work.
  if (dow.has(7)) dow.add(0);
  return {
    minute: expandField(fields[0], 0),
    hour: expandField(fields[1], 1),
    dom: expandField(fields[2], 2),
    month: expandField(fields[3], 3),
    dow,
    domRestricted: fields[2] !== "*",
    dowRestricted: fields[4] !== "*",
  };
}

// True iff `date` (interpreted in LOCAL time, matching a host cron daemon) falls
// within the minute the cron expression selects. Throws on a malformed or
// out-of-range expression so a bad spec fails loudly rather than silently never
// firing.
export function cronMatches(expr: string, date: Date): boolean {
  const c = parseCron(expr);

  if (!c.minute.has(date.getMinutes())) return false;
  if (!c.hour.has(date.getHours())) return false;
  if (!c.month.has(date.getMonth() + 1)) return false;

  const domHit = c.dom.has(date.getDate());
  const dowHit = c.dow.has(date.getDay());

  // Both restricted -> OR; otherwise AND (an unrestricted "*" field is always a
  // hit, so the AND collapses to whichever field is actually restricted).
  if (c.domRestricted && c.dowRestricted) return domHit || dowHit;
  return domHit && dowHit;
}

// The swarm service name for a cron job. Imperative one-shot services live
// OUTSIDE the deployed stack (they're created on a schedule, not by `docker
// stack deploy`), so they need an explicit name — derived from the stack name
// so the stack stays the single namespace source of truth, no magic prefix.
export function jobServiceName(stackName: string, jobName: string): string {
  return `${stackName}-cron-${jobName}`;
}

// Select the cron job named `name` for an on-demand run (`bosun run-job`).
// Throws a clear, actionable error when the name is unknown (listing the real
// jobs) or names a real service that is not a cron job (no `schedule`), so an
// operator typo fails loudly instead of silently doing nothing.
export function selectCronJob(services: ServiceSpec[], name: string): ServiceSpec {
  const match = services.find((s) => s.name === name);
  if (!match) {
    const jobs = services
      .filter((s) => s.schedule)
      .map((s) => s.name)
      .join(", ");
    throw new Error(`unknown cron job '${name}'. Declared cron jobs: ${jobs || "(none)"}`);
  }
  if (!match.schedule) {
    throw new Error(
      `'${name}' is not a cron job (it has no schedule); run-job only runs cronJob()s`,
    );
  }
  return match;
}

// Translate a docker-compose volume string ("src:dst[:ro]") into a swarm
// `docker service create --mount` flag. A path source is a bind mount; a bare
// name is a named volume.
function mountFlag(vol: string): string {
  const [source, target, mode] = vol.split(":");
  const type = source.startsWith("/") || source.startsWith(".") ? "bind" : "volume";
  const readonly = mode === "ro" ? ",readonly" : "";
  return `--mount type=${type},source=${source},target=${target}${readonly}`;
}

// Build the shell command that runs one cron job as a temporary Swarm one-shot
// service. Each run removes any prior (completed) job service of the same name
// and recreates it with `--mode replicated-job`, which runs the task to
// completion and then stops (no restart loop). Returned as a single string for
// the sh -c Runner (the same Runner used by health probes), so quotes/filters in
// `command` are re-parsed by the shell exactly as written in the spec.
//
// vs a node-local `docker run`: the job is visible in `docker service ls`,
// cluster-scheduled, and supports `--with-registry-auth` for private images.
// `slot` (when supplied by the scheduler) is stamped as a `bosun.cron-slot`
// label so a restarted scheduler can tell, from swarm state alone, whether this
// slot already ran — the swarm-derived dedupe key. A manual `run-job` passes no
// slot (always fires).
// NOTE (www-ke9a): cron jobs render via THIS `docker service create` path, not
// the compose stack, so the memory-limit framework in reconcile/stack.ts does NOT
// reach them. Today's jobs (docker-image-prune, map-extract) are short-lived and
// not memory-hungry, so they are out of scope. If a future job is memory-heavy,
// add a `resources` field here and emit `--limit-memory <mem>` (and the overcommit
// sum would need to account for the worst-case concurrent job too) — tracked as a
// follow-up, deliberately not blocking the long-lived-service framework.
export function buildJobCommand(
  job: ServiceSpec,
  stackName: string,
  slot?: string,
  // Already-resolved secret values (name -> value), injected as --env at create
  // time. buildJobCommand stays PURE: the caller (runDueJobs / run-job) resolves
  // the op refs and passes the values in; this function never touches op. A
  // manual run-job for a no-secret job passes none (www-q002.13).
  resolvedSecrets?: Record<string, string>,
): string {
  if (!job.schedule) throw new Error(`job '${job.name}' has no schedule`);

  const svc = jobServiceName(stackName, job.name);
  const parts = [
    // Clear the prior run's completed job service (ignore "not found"), then
    // recreate it fresh for this run.
    `docker service rm ${svc} >/dev/null 2>&1;`,
    "docker service create",
    "--mode replicated-job",
    "--restart-condition none",
    `--name ${svc}`,
    "--with-registry-auth",
    `--label bosun.cron-job=${job.name}`,
  ];
  if (slot) parts.push(`--label bosun.cron-slot=${slot}`);
  for (const c of job.placement ?? []) parts.push(`--constraint ${c}`);
  for (const vol of job.volumes ?? []) parts.push(mountFlag(vol));
  for (const key of Object.keys(job.env).sort()) parts.push(`--env ${key}=${job.env[key]}`);
  // Resolved op secrets after the static env, sorted for deterministic output.
  for (const key of Object.keys(resolvedSecrets ?? {}).sort()) {
    parts.push(`--env ${key}=${(resolvedSecrets as Record<string, string>)[key]}`);
  }
  parts.push(job.image);
  if (job.command) parts.push(job.command);
  return parts.join(" ");
}

// Select the schedule-bearing services whose cron matches `now`. Non-job
// services (no `schedule`) are ignored.
export function dueCronJobs(services: ServiceSpec[], now: Date): ServiceSpec[] {
  return services.filter((s) => s.schedule && cronMatches(s.schedule.cron, now));
}

// Minute-resolution slot identity, distinct per wall-clock minute. Stamped on
// the job service as `bosun.cron-slot` when fired, so a restarted scheduler can
// recognise a slot it (or its predecessor) already ran from swarm state alone —
// no in-memory bookkeeping that a restart would lose.
export function slotKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}T${d.getHours()}:${d.getMinutes()}`;
}

// A read of the current swarm state for one job service: the slot label its last
// run was stamped with (null if the service does not exist), and whether a task
// is still executing. This IS the scheduler's memory — held by swarm, so it
// survives an agent restart. Injected so runDueJobs is testable without docker.
export type JobInspector = (svc: string) => Promise<{ slot: string | null; inFlight: boolean }>;

// A no-op fallback logger when no real logger is injected (e.g. pure unit tests
// that don't care about log output). The default is intentionally silent.
const NOOP_LOGGER: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
} as unknown as Logger;

// Run every job due at `now`. Both guards are derived from swarm (via the
// injected inspector), not in-memory state, so a just-restarted scheduler makes
// the same decision the pre-crash one would have:
//   - slot already stamped on the service  -> skip (restart-safe dedupe)
//   - a task still in flight                -> skip (restart-safe overlap guard)
//   - otherwise                             -> fire, stamping THIS slot
// An inspector error skips the tick (never fire blind — the next tick retries),
// and a runner error is logged, never thrown, so one bad job can't kill the loop.
// Resolve a single op:// ref to its value. The agent passes its serialized
// OpProvider's resolve; tests inject a stub. Kept narrow (one ref -> value) so
// the scheduler never imports the provider directly (www-q002.13).
export type SecretResolver = (ref: string) => Promise<string>;

export async function runDueJobs(
  services: ServiceSpec[],
  now: Date,
  runner: Runner,
  inspect: JobInspector,
  stackName: string,
  log: Logger = NOOP_LOGGER,
  // When a due job declares secrets, each ref is resolved through this right
  // before dispatch and injected as --env. A job WITH secrets but no resolver is
  // skipped (never fire without its secrets); a no-secret job ignores it.
  resolveSecret?: SecretResolver,
): Promise<void> {
  const slot = slotKey(now);
  const due = dueCronJobs(services, now);

  // Debug heartbeat: how many jobs are due this tick.
  log.debug({ slot, dueCount: due.length }, "scheduler tick");

  await Promise.all(
    due.map(async (job) => {
      const svc = jobServiceName(stackName, job.name);
      let view: { slot: string | null; inFlight: boolean };
      try {
        view = await inspect(svc);
      } catch (err) {
        log.warn({ err, job: job.name, slot }, "inspect failed, skipping slot");
        return;
      }
      if (view.slot === slot) {
        log.debug({ job: job.name, slot }, "already ran this slot (per swarm), skipping");
        return;
      }
      if (view.inFlight) {
        log.debug({ job: job.name, slot }, "still in flight (per swarm), skipping slot");
        return;
      }
      // Resolve op secrets for this run, if any. A secret-bearing job with no
      // resolver is skipped — it must never fire without its secrets. Resolution
      // failure is logged (ref path only, never the value) and skips this slot;
      // the next tick retries.
      let resolvedSecrets: Record<string, string> | undefined;
      if (job.secrets.length > 0) {
        if (!resolveSecret) {
          log.warn(
            { job: job.name, slot },
            "job declares secrets but no resolver supplied — skipping (never fire without secrets)",
          );
          return;
        }
        try {
          resolvedSecrets = {};
          for (const sec of job.secrets) {
            // Serialized one-at-a-time (the OpProvider chains internally too).
            resolvedSecrets[sec.name] = await resolveSecret(sec.ref);
          }
        } catch (err) {
          // Log the ref path, NEVER the value — same discipline as OpProvider.
          log.error({ err, job: job.name, slot }, "secret resolve failed, skipping slot");
          return;
        }
      }

      const cmd = buildJobCommand(job, stackName, slot, resolvedSecrets);
      log.info({ job: job.name, slot }, "dispatching cron job");
      try {
        const { exitCode } = await runner(cmd);
        if (exitCode !== 0) {
          // Non-zero exit from the docker service create (e.g. image pull failed).
          log.warn({ job: job.name, slot, exitCode }, "cron job dispatched with non-zero exit");
        } else {
          log.info({ job: job.name, slot, exitCode }, "cron job dispatched");
        }
      } catch (err) {
        log.error({ err, job: job.name, slot }, "cron job runner threw");
      }
    }),
  );
}

// The live JobInspector: reads the slot label and task liveness straight from
// the swarm via the docker socket the agent already holds. Captures stdout (the
// health Runner only yields an exit code), so it is built on Bun.spawn directly.
const NON_TERMINAL_TASK_STATES = [
  "new",
  "allocated",
  "pending",
  "assigned",
  "accepted",
  "preparing",
  "ready",
  "starting",
  "running",
];

async function capture(cmd: string): Promise<{ stdout: string; exitCode: number }> {
  const proc = Bun.spawn(["sh", "-c", cmd], { stdout: "pipe", stderr: "ignore" });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { stdout, exitCode };
}

function makeDefaultJobInspector(): JobInspector {
  return async (svc: string) => {
    // The slot label off the service spec. A missing service exits non-zero; a
    // present-but-unlabelled service prints Go's "<no value>" — both mean null.
    const slotOut = await capture(
      `docker service inspect ${svc} --format '{{index .Spec.Labels "bosun.cron-slot"}}'`,
    );
    if (slotOut.exitCode !== 0) return { slot: null, inFlight: false };
    const raw = slotOut.stdout.trim();
    const slot = raw === "" || raw === "<no value>" ? null : raw;

    // A task is in flight if its current state is any non-terminal lifecycle
    // word. `docker service ps` prints e.g. "Running 3 seconds ago".
    const psOut = await capture(`docker service ps ${svc} --no-trunc --format '{{.CurrentState}}'`);
    const inFlight =
      psOut.exitCode === 0 &&
      psOut.stdout
        .split("\n")
        .map((l) => l.trim().toLowerCase())
        .some((l) => NON_TERMINAL_TASK_STATES.some((s) => l.startsWith(s)));

    return { slot, inFlight };
  };
}

// Start the live scheduler: tick once per minute, running due jobs via the
// injected runner. Returns a stop() that clears the interval. The timer is the
// only impure part; all decision logic lives in the pure helpers above.
export function startScheduler(
  services: ServiceSpec[],
  stackName: string,
  runner: Runner,
  // Defaults to the no-op logger; cli.ts passes a pino child bound to step:"scheduler".
  log: Logger = NOOP_LOGGER,
  // Resolves a job's op secret refs at dispatch time (the agent's OpProvider). A
  // secret-bearing job with no resolver is skipped by runDueJobs (www-q002.13).
  resolveSecret?: SecretResolver,
): () => void {
  const jobs = services.filter((s) => s.schedule);
  // No in-memory run-state: the inspector reads dedupe/overlap truth from swarm
  // each tick, so a restarted agent recovers its decisions for free.
  const inspect = makeDefaultJobInspector();
  log.info({ jobCount: jobs.length, jobs: jobs.map((j) => j.name) }, "scheduler started");
  // Tick every 30s so a job is never missed within its target minute even if a
  // tick lands late; the swarm-derived slot guard collapses the two ticks to one run.
  const timer = setInterval(() => {
    void runDueJobs(jobs, new Date(), runner, inspect, stackName, log, resolveSecret);
  }, 30_000);
  return () => clearInterval(timer);
}
