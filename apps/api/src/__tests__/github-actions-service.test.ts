import { describe, expect, it } from "vitest";

import {
  commitStateForRun,
  DEPLOY_JOB_NAME,
  IDLE_POLL_MS,
  LOG_TAIL_BYTES,
  logTailOf,
  parseCommitResponse,
  parseCompareResponse,
  parseJobsResponse,
  parseRunsResponse,
  shouldPollNow,
} from "../services/github-actions-service";

// Fixtures are shape-real recordings of the GitHub REST payload fields the
// edge schemas consume (spec §Testing): a green run with deploy SKIPPED by
// path filters, a job-level failure while the run is still in flight, and the
// usual success case.

function runFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 16_500_000_001,
    run_number: 412,
    name: "CI",
    head_sha: "45d404effaaaabbbbccccddddeeeeffff00001111",
    status: "completed",
    conclusion: "success",
    html_url: "https://github.com/0x63616c/world-wide-webb/actions/runs/16500000001",
    created_at: "2026-07-18T16:00:00Z",
    run_started_at: "2026-07-18T16:00:05Z",
    updated_at: "2026-07-18T16:12:00Z",
    head_commit: {
      message: "feat(control-center/api): github deploy poller",
      author: { name: "Calum" },
    },
    // Real payloads carry dozens more fields; zod must tolerate them.
    actor: { login: "0x63616c" },
    ...overrides,
  };
}

describe("parseRunsResponse", () => {
  it("maps a completed run to a row item, using updated_at as completion time", () => {
    const [run] = parseRunsResponse({ workflow_runs: [runFixture()] });
    expect(run).toMatchObject({
      id: 16_500_000_001,
      runNumber: 412,
      workflowName: "CI",
      status: "completed",
      conclusion: "success",
      commitMessage: "feat(control-center/api): github deploy poller",
      commitAuthor: "Calum",
    });
    expect(run?.startedAtUtc.toISOString()).toBe("2026-07-18T16:00:05.000Z");
    expect(run?.completedAtUtc?.toISOString()).toBe("2026-07-18T16:12:00.000Z");
  });

  it("leaves completedAtUtc null while a run is in flight and falls back to created_at when queued", () => {
    const [run] = parseRunsResponse({
      workflow_runs: [runFixture({ status: "queued", conclusion: null, run_started_at: null })],
    });
    expect(run?.completedAtUtc).toBeNull();
    expect(run?.startedAtUtc.toISOString()).toBe("2026-07-18T16:00:00.000Z");
  });

  it("tolerates a missing head_commit", () => {
    const [run] = parseRunsResponse({ workflow_runs: [runFixture({ head_commit: null })] });
    expect(run?.commitMessage).toBeNull();
    expect(run?.commitAuthor).toBeNull();
  });

  it("rejects a malformed payload loudly", () => {
    expect(() => parseRunsResponse({ workflow_runs: [{ id: "nope" }] })).toThrow();
  });
});

function job(name: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 46_000_000_100 + name.length,
    name,
    status: "completed",
    conclusion: "success",
    steps: [{ name: "Checkout", status: "completed", conclusion: "success" }],
    ...overrides,
  };
}

describe("parseJobsResponse", () => {
  it("reads the deploy job conclusion on a fully green run", () => {
    const summary = parseJobsResponse({
      jobs: [job("test"), job("build-web"), job(DEPLOY_JOB_NAME)],
    });
    expect(summary.deployJobConclusion).toBe("success");
    expect(summary.failed).toBeNull();
    expect(summary.current).toBeNull();
  });

  it("reports deploy SKIPPED on a green run whose path filters skipped deploy", () => {
    // This is the case that makes job-level polling load-bearing: the RUN
    // concludes success, but nothing new was deployed.
    const summary = parseJobsResponse({
      jobs: [job("test"), job(DEPLOY_JOB_NAME, { conclusion: "skipped" })],
    });
    expect(summary.deployJobConclusion).toBe("skipped");
  });

  it("catches a job-level failure while the run is still in flight", () => {
    const summary = parseJobsResponse({
      jobs: [
        job("build-web", {
          conclusion: "failure",
          steps: [
            { name: "Checkout", status: "completed", conclusion: "success" },
            { name: "docker buildx", status: "completed", conclusion: "failure" },
          ],
        }),
        job(DEPLOY_JOB_NAME, { status: "queued", conclusion: null }),
        job("build-api", {
          status: "in_progress",
          conclusion: null,
          steps: [{ name: "Build image", status: "in_progress", conclusion: null }],
        }),
      ],
    });
    expect(summary.failed).toMatchObject({ jobName: "build-web", stepName: "docker buildx" });
    expect(summary.current).toMatchObject({ jobName: "build-api", stepName: "Build image" });
    // Deploy has not finished, so it must NOT report a conclusion yet.
    expect(summary.deployJobConclusion).toBeNull();
  });
});

describe("parseCommitResponse / parseCompareResponse", () => {
  it("extracts the diffstat and changed-file count", () => {
    const detail = parseCommitResponse({
      sha: "45d404eff",
      stats: { additions: 120, deletions: 8, total: 128 },
      files: [{ filename: "a.ts" }, { filename: "b.ts" }],
    });
    expect(detail).toEqual({
      sha: "45d404eff",
      additions: 120,
      deletions: 8,
      changedFileCount: 2,
    });
  });

  it("reads ahead_by from a compare payload", () => {
    expect(parseCompareResponse({ ahead_by: 3, behind_by: 0, status: "ahead" })).toBe(3);
  });
});

describe("logTailOf", () => {
  it("keeps a short log whole and truncates a long one to the last 4KB", () => {
    expect(logTailOf("short log")).toBe("short log");
    const long = `${"x".repeat(LOG_TAIL_BYTES)}TAIL-MARKER`;
    const tail = logTailOf(long);
    expect(tail.length).toBe(LOG_TAIL_BYTES);
    expect(tail.endsWith("TAIL-MARKER")).toBe(true);
  });
});

describe("shouldPollNow", () => {
  it("polls every tick while a run is in flight", () => {
    expect(shouldPollNow(1_000_000, true, 1_000_100)).toBe(true);
  });

  it("waits out the idle gap when nothing is in flight", () => {
    expect(shouldPollNow(1_000_000, false, 1_000_000 + 10_000)).toBe(false);
    expect(shouldPollNow(1_000_000, false, 1_000_000 + IDLE_POLL_MS)).toBe(true);
  });
});

describe("commitStateForRun", () => {
  it("maps run rows to the feed's per-commit deploy state", () => {
    const base = { status: "completed", conclusion: "success", deployJobConclusion: "success" };
    expect(commitStateForRun(base)).toBe("deployed");
    expect(commitStateForRun({ ...base, status: "in_progress", conclusion: null })).toBe(
      "building",
    );
    expect(
      commitStateForRun({ ...base, conclusion: "failure", deployJobConclusion: "failure" }),
    ).toBe("failed");
    // Green run, deploy skipped by path filters: NOT "deployed".
    expect(commitStateForRun({ ...base, deployJobConclusion: "skipped" })).toBe("skipped");
  });
});
