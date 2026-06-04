import { describe, expect, it, vi } from "vitest";
import { type Fetcher, type Runner, runProbes } from "../src/health.ts";
import type { HealthProbe } from "../src/spec.ts";

// Dependency-injected HTTP fetcher and shell runner so no real network or
// process is required in tests.

function makeFetcher(responses: Array<{ status: number; ok: boolean }>): Fetcher {
  let call = 0;
  return vi.fn().mockImplementation(async () => {
    const r = responses[call++ % responses.length];
    return r;
  });
}

function makeRunner(exitCode: number): Runner {
  return vi.fn().mockResolvedValue({ exitCode });
}

describe("runProbes — all pass", () => {
  it("returns exit code 0 when all http probes return the expected status", async () => {
    const probes: HealthProbe[] = [
      { kind: "http", description: "api up", url: "http://api:4201/up", expectedStatus: 200 },
      {
        kind: "http",
        description: "web up",
        url: "https://dashboard.worldwidewebb.co",
        expectedStatus: 200,
      },
    ];
    const fetcher = makeFetcher([
      { status: 200, ok: true },
      { status: 200, ok: true },
    ]);
    const runner = makeRunner(0);

    const result = await runProbes(probes, { fetcher, runner });

    expect(result.exitCode).toBe(0);
    expect(result.results).toHaveLength(2);
    expect(result.results.every((r) => r.pass)).toBe(true);
  });

  it("returns exit code 0 when all cmd probes exit 0", async () => {
    const probes: HealthProbe[] = [
      { kind: "cmd", description: "postgres ready", command: "pg_isready -U postgres" },
    ];
    const fetcher = makeFetcher([]);
    const runner = makeRunner(0);

    const result = await runProbes(probes, { fetcher, runner });

    expect(result.exitCode).toBe(0);
    expect(result.results[0].pass).toBe(true);
  });

  it("returns exit code 0 for a mixed set of passing http and cmd probes", async () => {
    const probes: HealthProbe[] = [
      { kind: "http", description: "api ping", url: "http://api/ping", expectedStatus: 200 },
      { kind: "cmd", description: "db ready", command: "pg_isready" },
    ];
    const fetcher = makeFetcher([{ status: 200, ok: true }]);
    const runner = makeRunner(0);

    const result = await runProbes(probes, { fetcher, runner });

    expect(result.exitCode).toBe(0);
    expect(result.results).toHaveLength(2);
    expect(result.results.every((r) => r.pass)).toBe(true);
  });

  it("returns exit code 0 with an empty probe list (nothing to fail)", async () => {
    const result = await runProbes([], { fetcher: makeFetcher([]), runner: makeRunner(0) });
    expect(result.exitCode).toBe(0);
    expect(result.results).toHaveLength(0);
  });
});

describe("runProbes — failures reported", () => {
  it("returns non-zero exit code when an http probe gets the wrong status", async () => {
    const probes: HealthProbe[] = [
      {
        kind: "http",
        description: "impossible probe",
        url: "http://never-resolve",
        expectedStatus: 200,
      },
    ];
    // Simulate server returning 503 instead of the expected 200.
    const fetcher = makeFetcher([{ status: 503, ok: false }]);
    const runner = makeRunner(0);

    const result = await runProbes(probes, { fetcher, runner });

    expect(result.exitCode).not.toBe(0);
    expect(result.results[0].pass).toBe(false);
  });

  it("includes a human-readable failure reason in the result", async () => {
    const probes: HealthProbe[] = [
      {
        kind: "http",
        description: "bad probe",
        url: "http://bad",
        expectedStatus: 200,
      },
    ];
    const fetcher = makeFetcher([{ status: 404, ok: false }]);
    const result = await runProbes(probes, { fetcher, runner: makeRunner(0) });

    expect(result.results[0].reason).toBeTruthy();
    expect(result.results[0].reason).toMatch(/404/);
  });

  it("returns non-zero exit code when a cmd probe exits non-zero", async () => {
    const probes: HealthProbe[] = [
      { kind: "cmd", description: "impossible cmd", command: "false" },
    ];
    const result = await runProbes(probes, {
      fetcher: makeFetcher([]),
      runner: makeRunner(1),
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.results[0].pass).toBe(false);
  });

  it("reports per-probe results with description attached", async () => {
    const probes: HealthProbe[] = [
      { kind: "http", description: "passing probe", url: "http://ok", expectedStatus: 200 },
      {
        kind: "http",
        description: "failing probe",
        url: "http://fail",
        expectedStatus: 200,
      },
    ];
    const fetcher = makeFetcher([
      { status: 200, ok: true },
      { status: 500, ok: false },
    ]);
    const result = await runProbes(probes, { fetcher, runner: makeRunner(0) });

    expect(result.exitCode).not.toBe(0);
    expect(result.results[0].description).toBe("passing probe");
    expect(result.results[0].pass).toBe(true);
    expect(result.results[1].description).toBe("failing probe");
    expect(result.results[1].pass).toBe(false);
  });

  it("returns non-zero when only one probe in a mixed set fails", async () => {
    const probes: HealthProbe[] = [
      { kind: "http", description: "ok", url: "http://ok", expectedStatus: 200 },
      { kind: "cmd", description: "fail", command: "exit 1" },
    ];
    const fetcher = makeFetcher([{ status: 200, ok: true }]);
    // Runner always exits 1 — the cmd probe fails.
    const result = await runProbes(probes, { fetcher, runner: makeRunner(1) });

    expect(result.exitCode).not.toBe(0);
    expect(result.results[0].pass).toBe(true);
    expect(result.results[1].pass).toBe(false);
  });
});
