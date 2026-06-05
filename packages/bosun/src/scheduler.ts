// bosun-native cron scheduler. Runs entirely inside the long-lived `bosun serve`
// agent (manager node, docker socket) — no third-party scheduler container and
// no deploy labels. Jobs are declared with cronJob() in the spec; this module
// matches their 5-field cron against the wall clock each minute and executes the
// due ones via the docker socket the agent already holds.
//
// Everything here is pure or dependency-injected (clock + runner) so the
// matching, selection, command-building, and guard logic are unit-testable
// without real timers or a real docker daemon — mirroring health.ts.

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
export function buildJobCommand(job: ServiceSpec, stackName: string): string {
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
  for (const c of job.placement ?? []) parts.push(`--constraint ${c}`);
  for (const vol of job.volumes ?? []) parts.push(mountFlag(vol));
  for (const key of Object.keys(job.env).sort()) parts.push(`--env ${key}=${job.env[key]}`);
  parts.push(job.image);
  if (job.command) parts.push(job.command);
  return parts.join(" ");
}

// Select the schedule-bearing services whose cron matches `now`. Non-job
// services (no `schedule`) are ignored.
export function dueCronJobs(services: ServiceSpec[], now: Date): ServiceSpec[] {
  return services.filter((s) => s.schedule && cronMatches(s.schedule.cron, now));
}

// Mutable run-state carried across ticks: the last minute key each job ran in
// (so a job fires at most once per matching minute even if the tick double-fires)
// and the set of jobs still executing (so a long run is not started concurrently
// with itself on the next tick).
export interface SchedulerState {
  lastRunMinute: Map<string, string>;
  inFlight: Set<string>;
}

export function newSchedulerState(): SchedulerState {
  return { lastRunMinute: new Map(), inFlight: new Set() };
}

// Minute-resolution key, distinct per wall-clock minute.
function minuteKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}T${d.getHours()}:${d.getMinutes()}`;
}

type Logger = (msg: string) => void;

// Run every job due at `now`, honoring the per-minute and in-flight guards.
// Each job is fired through the injected runner (the docker invocation built by
// buildJobCommand). Failures are logged, never thrown — one bad job must not
// kill the scheduler loop.
export async function runDueJobs(
  services: ServiceSpec[],
  now: Date,
  runner: Runner,
  state: SchedulerState,
  stackName: string,
  log: Logger = () => {},
): Promise<void> {
  const key = minuteKey(now);
  const due = dueCronJobs(services, now);

  await Promise.all(
    due.map(async (job) => {
      if (state.lastRunMinute.get(job.name) === key) return; // already ran this minute
      if (state.inFlight.has(job.name)) {
        log(`[scheduler] '${job.name}' still in flight, skipping this tick`);
        return;
      }
      state.lastRunMinute.set(job.name, key);
      state.inFlight.add(job.name);
      const cmd = buildJobCommand(job, stackName);
      log(`[scheduler] running '${job.name}': ${cmd}`);
      try {
        const { exitCode } = await runner(cmd);
        log(`[scheduler] '${job.name}' exited ${exitCode}`);
      } catch (err) {
        log(`[scheduler] '${job.name}' error: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        state.inFlight.delete(job.name);
      }
    }),
  );
}

// Start the live scheduler: tick once per minute, running due jobs via the
// injected runner. Returns a stop() that clears the interval. The timer is the
// only impure part; all decision logic lives in the pure helpers above.
export function startScheduler(
  services: ServiceSpec[],
  stackName: string,
  runner: Runner,
  // Defaults to silent; cli.ts (the console-allowed entry point) passes console.log.
  log: Logger = () => {},
): () => void {
  const jobs = services.filter((s) => s.schedule);
  const state = newSchedulerState();
  log(
    `[scheduler] managing ${jobs.length} cron job(s): ${jobs.map((j) => j.name).join(", ") || "(none)"}`,
  );
  // Tick every 30s so a job is never missed within its target minute even if a
  // tick lands late; the per-minute guard collapses the two ticks to one run.
  const timer = setInterval(() => {
    void runDueJobs(jobs, new Date(), runner, state, stackName, log);
  }, 30_000);
  return () => clearInterval(timer);
}
