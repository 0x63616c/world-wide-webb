// Tests for the verify command behavior (ac_tool_health).
// Validates that bosun verify exits 0 only when all probes pass, and exits
// non-zero with per-probe reporting when any probe fails.

import { describe, expect, it, vi } from "vitest";
import type { Fetcher, Runner } from "../src/health.ts";
import { formatReport, runProbes, summarizeVerify } from "../src/health.ts";
import { cmdProbe, httpProbe } from "../src/spec.ts";

// Mirrors what cmdVerify does internally: run probes, format report, check exit.

function makeFetcher(status: number): Fetcher {
  return vi.fn().mockResolvedValue({ status, ok: status >= 200 && status < 300 });
}

function makeRunner(exitCode: number): Runner {
  return vi.fn().mockResolvedValue({ exitCode });
}

describe("verify command behavior (ac_tool_health)", () => {
  it("exits 0 when all declared probes pass", async () => {
    const probes = [
      httpProbe("http://api:4201/up", 200),
      cmdProbe("postgres ready", "pg_isready -U postgres"),
    ];
    const result = await runProbes(probes, {
      fetcher: makeFetcher(200),
      runner: makeRunner(0),
    });
    // The CLI exits with result.exitCode — must be 0 when all pass.
    expect(result.exitCode).toBe(0);
    expect(result.results.every((r) => r.pass)).toBe(true);
  });

  it("exits non-zero when a single probe has an impossible expectation", async () => {
    // This is the checklist's "temporarily flip one probe to impossible" test.
    const probes = [
      httpProbe("http://api:4201/up", 999), // impossible — no server returns 999
    ];
    const result = await runProbes(probes, {
      fetcher: makeFetcher(200), // server returns 200, not 999
      runner: makeRunner(0),
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.results[0].pass).toBe(false);
  });

  it("produces a human-readable per-probe report on failure", async () => {
    const probes = [httpProbe("http://api:4201/up", 200), httpProbe("http://bad-service/up", 200)];
    const fetcher: Fetcher = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, ok: true })
      .mockResolvedValueOnce({ status: 503, ok: false });

    const result = await runProbes(probes, { fetcher, runner: makeRunner(0) });
    const report = formatReport(result.results);

    // Report must include both probe descriptions and distinguish pass/fail.
    expect(report).toContain("HTTP 200 from http://api:4201/up");
    expect(report).toContain("HTTP 200 from http://bad-service/up");
    // Failing probe must have a reason mentioning the actual status.
    expect(report).toContain("503");
  });

  it("runs all probes even when the first one fails (complete report always)", async () => {
    const probes = [
      httpProbe("http://fail-first/up", 200),
      httpProbe("http://pass-second/up", 200),
    ];
    const fetcher: Fetcher = vi
      .fn()
      .mockResolvedValueOnce({ status: 500, ok: false })
      .mockResolvedValueOnce({ status: 200, ok: true });

    const result = await runProbes(probes, { fetcher, runner: makeRunner(0) });

    // All probes ran, not short-circuited.
    expect(result.results).toHaveLength(2);
    expect(result.results[0].pass).toBe(false);
    expect(result.results[1].pass).toBe(true);
    // Exit code non-zero because first probe failed.
    expect(result.exitCode).not.toBe(0);
  });
});

// CC-1dx: the webhook serve path runs verify in advisory mode so a successful
// stack deploy whose probes are not-yet-warm never looks like a failed deploy.
describe("summarizeVerify — advisory vs failing verify policy (CC-1dx)", () => {
  it("fails (non-advisory) when a probe is red, so interactive `up` exits non-zero", async () => {
    const result = await runProbes([httpProbe("http://api:4201/up", 200)], {
      fetcher: makeFetcher(503),
      runner: makeRunner(0),
    });
    const { failed, lines } = summarizeVerify(result, false);
    expect(failed).toBe(true);
    // No advisory note when not advisory.
    expect(lines.join("\n")).not.toMatch(/advisory/);
  });

  it("does NOT fail in advisory mode even when a probe is red (serve path)", async () => {
    const result = await runProbes([httpProbe("http://api:4201/up", 200)], {
      fetcher: makeFetcher(503),
      runner: makeRunner(0),
    });
    const { failed, lines } = summarizeVerify(result, true);
    expect(failed).toBe(false);
    // Surfaces the not-all-green state as informational, not an error.
    expect(lines.join("\n")).toMatch(/advisory/);
    expect(lines.join("\n")).toMatch(/deploy still succeeded/);
  });

  it("never fails when all probes pass, advisory or not", async () => {
    const result = await runProbes([httpProbe("http://api:4201/up", 200)], {
      fetcher: makeFetcher(200),
      runner: makeRunner(0),
    });
    expect(summarizeVerify(result, false).failed).toBe(false);
    expect(summarizeVerify(result, true).failed).toBe(false);
    // No advisory note needed when green.
    expect(summarizeVerify(result, true).lines.join("\n")).not.toMatch(/advisory/);
  });
});
