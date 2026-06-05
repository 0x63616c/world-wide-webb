import type { HealthProbe } from "./spec.ts";

// Dependency-injected so tests mock without real network or child processes.
export type Fetcher = (url: string) => Promise<{ status: number; ok: boolean }>;
export type Runner = (cmd: string) => Promise<{ exitCode: number }>;

export interface ProbeResult {
  description: string;
  pass: boolean;
  // Human-readable reason when the probe fails (empty string when pass).
  reason: string;
}

export interface RunProbesResult {
  // 0 iff every probe passed, non-zero otherwise.
  exitCode: number;
  results: ProbeResult[];
}

// Run all declared probes and return a per-probe report plus a composite exit
// code. All probes run even when one fails so the report is complete.
export async function runProbes(
  probes: HealthProbe[],
  { fetcher, runner }: { fetcher: Fetcher; runner: Runner },
): Promise<RunProbesResult> {
  const results: ProbeResult[] = await Promise.all(
    probes.map((probe) => runSingleProbe(probe, fetcher, runner)),
  );

  const exitCode = results.every((r) => r.pass) ? 0 : 1;
  return { exitCode, results };
}

async function runSingleProbe(
  probe: HealthProbe,
  fetcher: Fetcher,
  runner: Runner,
): Promise<ProbeResult> {
  if (probe.kind === "http") {
    return runHttpProbe(probe, fetcher);
  }
  return runCmdProbe(probe, runner);
}

async function runHttpProbe(probe: HealthProbe, fetcher: Fetcher): Promise<ProbeResult> {
  try {
    const res = await fetcher(probe.url ?? "");
    const pass = res.status === probe.expectedStatus;
    return {
      description: probe.description,
      pass,
      reason: pass ? "" : `expected HTTP ${probe.expectedStatus}, got ${res.status}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { description: probe.description, pass: false, reason: `fetch error: ${msg}` };
  }
}

async function runCmdProbe(probe: HealthProbe, runner: Runner): Promise<ProbeResult> {
  try {
    const { exitCode } = await runner(probe.command ?? "");
    const pass = exitCode === 0;
    return {
      description: probe.description,
      pass,
      reason: pass ? "" : `command exited ${exitCode}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { description: probe.description, pass: false, reason: `runner error: ${msg}` };
  }
}

// Summarise a probe run into the lines to log and whether the caller should
// treat it as a failure. `advisory` callers (the webhook serve path) never fail:
// a deployed-but-not-yet-warm probe must not make a successful stack deploy look
// like a failed one (www-1dx). Pure so the build/serve verify policy is testable
// without process.exit or a real deploy.
export function summarizeVerify(
  result: RunProbesResult,
  advisory: boolean,
): { lines: string[]; failed: boolean } {
  const passed = result.results.filter((r) => r.pass).length;
  const lines = [
    `\nHealth probes: ${passed}/${result.results.length} passed`,
    formatReport(result.results),
  ];
  const red = result.exitCode !== 0;
  if (red && advisory) {
    // Stack deploy already succeeded; verify is informational on this path.
    lines.push("[verify] advisory: probes not all green (deploy still succeeded); not failing");
  }
  return { lines, failed: red && !advisory };
}

// Format per-probe results as a human-readable report string.
export function formatReport(results: ProbeResult[]): string {
  return results
    .map((r) => {
      const mark = r.pass ? "✓" : "✗";
      const tail = r.pass ? "" : `\n    reason: ${r.reason}`;
      return `  ${mark} ${r.description}${tail}`;
    })
    .join("\n");
}

// Default fetch implementation using the global fetch API (available in Bun).
export function makeDefaultFetcher(): Fetcher {
  return async (url: string) => {
    const res = await fetch(url);
    return { status: res.status, ok: res.ok };
  };
}

// Default shell runner using Bun's subprocess API.
export function makeDefaultRunner(): Runner {
  return async (cmd: string) => {
    const proc = Bun.spawn(["sh", "-c", cmd], { stdout: "inherit", stderr: "inherit" });
    const exitCode = await proc.exited;
    return { exitCode };
  };
}
