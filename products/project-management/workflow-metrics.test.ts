import { describe, expect, it } from "vitest";
import { percentile, workflowMetricsForIssues } from "./workflow-metrics";

describe("workflowMetricsForIssues", () => {
  it("aggregates workflow counts, durations, and OpenCode stats", () => {
    const metrics = workflowMetricsForIssues([
      issue("www-a", "closed", ["ticket-verified"], {
        ticket_phase: "closed",
        ticket_attempts: 1,
        ticket_last_result: "merge-passed",
        ticket_duration_ms: 100,
        ticket_opencode_session: "Builder (ses_a)",
        ticket_opencode_tokens: 1000,
        ticket_opencode_cost_usd: 0.25,
      }),
      issue("www-b", "open", ["ticket-ready", "ticket-retry"], {
        ticket_phase: "build",
        ticket_attempts: 2,
        ticket_last_result: "builder-timeout",
        ticket_duration_ms: 200,
        ticket_opencode_tokens: "250",
        ticket_opencode_cost_usd: "0.125",
      }),
      issue("www-c", "blocked", ["ticket-human"], {
        ticket_phase: "human",
        ticket_started_at: "2026-06-19T00:00:00.000Z",
        ticket_finished_at: "2026-06-19T00:00:00.300Z",
      }),
    ]);

    expect(metrics.counts).toEqual({
      started: 3,
      built: 1,
      reviewed: 1,
      merged: 1,
      closed: 1,
      failed: 1,
      retried: 1,
      humanEscalated: 1,
    });
    expect(metrics.durations).toEqual({
      samples: 3,
      averageMs: 200,
      p50Ms: 200,
      p90Ms: 300,
      p95Ms: 300,
    });
    expect(metrics.openCode).toEqual({
      available: true,
      sessions: 1,
      tokens: 1250,
      costUsd: 0.375,
    });
  });

  it("exposes quota snapshots and non-fatal parse errors", () => {
    const parsed = workflowMetricsForIssues([
      issue("www-quota", "open", ["ticket-ready"], {
        ticket_quota_snapshot: JSON.stringify({ provider: "opencode", remaining: 12 }),
      }),
    ]);
    const failed = workflowMetricsForIssues([
      issue("www-quota-bad", "open", ["ticket-ready"], { ticket_quota_snapshot: "{" }),
    ]);

    expect(parsed.quota).toEqual({
      available: true,
      snapshot: { provider: "opencode", remaining: 12 },
      error: null,
    });
    expect(failed.quota.available).toBe(false);
    expect(failed.quota.snapshot).toBeNull();
    expect(failed.quota.error).toContain("Expected");
  });
});

describe("percentile", () => {
  it("uses nearest-rank percentile over sorted durations", () => {
    expect(percentile([10, 20, 30, 40, 50], 50)).toBe(30);
    expect(percentile([10, 20, 30, 40, 50], 90)).toBe(50);
    expect(percentile([], 95)).toBeNull();
  });
});

function issue(
  id: string,
  status: "ready" | "in_progress" | "blocked" | "closed" | "open",
  labels: string[],
  metadata: Record<string, unknown>,
) {
  return {
    id,
    title: id,
    status: status === "open" ? "ready" : status,
    assignee: "Calum",
    labels,
    metadata,
  };
}
