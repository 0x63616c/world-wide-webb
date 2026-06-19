import { TICKET_METADATA_KEYS, TICKET_WORKFLOW_LABELS } from "./beads-adapter";
import type { WorkflowDashboardIssueInput } from "./workflow";

export const WORKFLOW_METRIC_COUNT_KEYS = [
  "started",
  "built",
  "reviewed",
  "merged",
  "closed",
  "failed",
  "retried",
  "humanEscalated",
] as const;

export type WorkflowMetricCountKey = (typeof WORKFLOW_METRIC_COUNT_KEYS)[number];

export type WorkflowMetrics = {
  readonly counts: Record<WorkflowMetricCountKey, number>;
  readonly durations: {
    readonly samples: number;
    readonly averageMs: number | null;
    readonly p50Ms: number | null;
    readonly p90Ms: number | null;
    readonly p95Ms: number | null;
  };
  readonly openCode: {
    readonly available: boolean;
    readonly sessions: number;
    readonly tokens: number | null;
    readonly costUsd: number | null;
  };
  readonly quota: {
    readonly available: boolean;
    readonly snapshot: unknown | null;
    readonly error: string | null;
  };
};

export function workflowMetricsForIssues(
  issues: readonly WorkflowDashboardIssueInput[],
): WorkflowMetrics {
  const counts = emptyCounts();
  const durations: number[] = [];
  let sessions = 0;
  let tokens = 0;
  let sawTokens = false;
  let costUsd = 0;
  let sawCost = false;
  let quotaSnapshot: unknown | null = null;
  let quotaError: string | null = null;

  for (const issue of issues) {
    const metadata = issue.metadata ?? {};
    const labels = new Set(issue.labels);
    const phase = stringMeta(metadata, TICKET_METADATA_KEYS.phase);
    const lastResult = stringMeta(metadata, TICKET_METADATA_KEYS.lastResult);
    const attempts = numberMeta(metadata, TICKET_METADATA_KEYS.attempts) ?? 0;

    if (phase || attempts > 0) counts.started += 1;
    if (
      hasReached(phase, ["review", "verified", "merge", "closed"]) ||
      lastResult === "builder-passed"
    )
      counts.built += 1;
    if (hasReached(phase, ["verified", "merge", "closed"]) || lastResult === "reviewer-passed")
      counts.reviewed += 1;
    if (phase === "merge" || phase === "closed" || lastResult === "merge-passed")
      counts.merged += 1;
    if (issue.status === "closed" || phase === "closed") counts.closed += 1;
    if (isFailureResult(lastResult)) counts.failed += 1;
    if (labels.has(TICKET_WORKFLOW_LABELS.retry) || attempts > 1) counts.retried += 1;
    if (labels.has(TICKET_WORKFLOW_LABELS.human) || phase === "human") counts.humanEscalated += 1;

    const duration = durationMs(metadata);
    if (duration !== null) durations.push(duration);

    if (stringMeta(metadata, TICKET_METADATA_KEYS.openCodeSession)) sessions += 1;
    const issueTokens = numberMeta(metadata, "ticket_opencode_tokens");
    if (issueTokens !== null) {
      sawTokens = true;
      tokens += issueTokens;
    }
    const issueCost = numberMeta(metadata, "ticket_opencode_cost_usd");
    if (issueCost !== null) {
      sawCost = true;
      costUsd += issueCost;
    }

    const quota = parseQuotaSnapshot(metadata);
    if (quota.ok && quota.value !== null) quotaSnapshot = quota.value;
    if (!quota.ok) quotaError = quota.error;
  }

  return {
    counts,
    durations: summarizeDurations(durations),
    openCode: {
      available: sessions > 0 || sawTokens || sawCost,
      sessions,
      tokens: sawTokens ? tokens : null,
      costUsd: sawCost ? Number(costUsd.toFixed(4)) : null,
    },
    quota: {
      available: quotaSnapshot !== null,
      snapshot: quotaSnapshot,
      error: quotaError,
    },
  };
}

function emptyCounts(): Record<WorkflowMetricCountKey, number> {
  return {
    started: 0,
    built: 0,
    reviewed: 0,
    merged: 0,
    closed: 0,
    failed: 0,
    retried: 0,
    humanEscalated: 0,
  };
}

function hasReached(phase: string | null, phases: readonly string[]): boolean {
  return phase !== null && phases.includes(phase);
}

function isFailureResult(result: string | null): boolean {
  return result !== null && /failed|timeout|exhausted/.test(result);
}

function durationMs(metadata: Record<string, unknown>): number | null {
  const direct = numberMeta(metadata, "ticket_duration_ms");
  if (direct !== null) return direct;
  const startedAt = dateMsMeta(metadata, "ticket_started_at");
  const finishedAt =
    dateMsMeta(metadata, "ticket_finished_at") ?? dateMsMeta(metadata, "ticket_closed_at");
  if (startedAt === null || finishedAt === null || finishedAt < startedAt) return null;
  return finishedAt - startedAt;
}

function summarizeDurations(values: readonly number[]): WorkflowMetrics["durations"] {
  if (values.length === 0) {
    return { samples: 0, averageMs: null, p50Ms: null, p90Ms: null, p95Ms: null };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    samples: sorted.length,
    averageMs: Math.round(total / sorted.length),
    p50Ms: percentile(sorted, 50),
    p90Ms: percentile(sorted, 90),
    p95Ms: percentile(sorted, 95),
  };
}

export function percentile(sortedValues: readonly number[], percentileRank: number): number | null {
  if (sortedValues.length === 0) return null;
  const index = Math.ceil((percentileRank / 100) * sortedValues.length) - 1;
  return sortedValues[Math.min(Math.max(index, 0), sortedValues.length - 1)] ?? null;
}

function parseQuotaSnapshot(
  metadata: Record<string, unknown>,
):
  | { readonly ok: true; readonly value: unknown | null }
  | { readonly ok: false; readonly error: string } {
  const value = metadata.ticket_quota_snapshot ?? metadata.ticket_quota;
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  if (typeof value === "object") return { ok: true, value };
  if (typeof value !== "string")
    return { ok: false, error: "quota snapshot is not an object or JSON string" };
  try {
    return { ok: true, value: JSON.parse(value) as unknown };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function stringMeta(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  return null;
}

function numberMeta(metadata: Record<string, unknown>, key: string): number | null {
  const value = metadata[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateMsMeta(metadata: Record<string, unknown>, key: string): number | null {
  const value = metadata[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
