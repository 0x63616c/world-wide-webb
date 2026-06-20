import { describe, expect, it } from "vitest";
import type { MergeActivityResult, TicketWorkflowRuntimeConfig } from "./command-activities";
import {
  enqueueMergeQueueRequest,
  type MergeQueueActivities,
  type MergeQueueMutableState,
  type MergeQueueRequest,
  type MergeWorkflowActivities,
  type MergeWorkflowInput,
  type MergeWorkflowStep,
  mergeQueueSnapshot,
  processMergeQueueRequest,
  processNextMergeQueueEntry,
  recordMergeQueueResult,
  runSerializedMergeQueueWorkflow,
  runSerializedMergeWorkflow,
  shouldContinueMergeQueueAsNew,
} from "./workflows";

describe("runSerializedMergeWorkflow", () => {
  it("processes multiple ticket-verified items serially and stops the queue on first failure", async () => {
    const fake = fakeMergeActivities("final-gates", "www-3agy.12");
    const result = await runSerializedMergeQueueWorkflow(
      {
        tickets: [baseInput({ ticketId: "www-3agy.11" }), baseInput({ ticketId: "www-3agy.12" })],
      },
      fake.activities,
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: "failed",
        failedTicketId: "www-3agy.12",
      }),
    );
    expect(result.results.map((ticket) => [ticket.ticketId, ticket.status])).toEqual([
      ["www-3agy.11", "merged"],
      ["www-3agy.12", "failed"],
    ]);
    expect(fake.calls).toEqual([
      "update-main",
      "merge-ticket-branch",
      "final-gates",
      "sync-main-for-push",
      "push-main",
      "close-ticket",
      "push-beads",
      "update-main",
      "merge-ticket-branch",
      "final-gates",
      "merge-fix",
      "wait-merge-fix",
      "final-gates",
      "escalate-human",
    ]);
    expect(fake.maxConcurrent).toBe(1);
  });

  it("processes verified ticket work one deterministic Activity at a time and closes after push", async () => {
    const fake = fakeMergeActivities();
    const result = await runSerializedMergeWorkflow(baseInput(), fake.activities);

    expect(result).toEqual(
      expect.objectContaining({
        ticketId: "www-3agy.11",
        status: "merged",
        failedStep: null,
        pushed: true,
        closed: true,
      }),
    );
    expect(result.steps.map((step) => [step.step, step.ok])).toEqual([
      ["update-main", true],
      ["merge-ticket-branch", true],
      ["final-gates", true],
      ["sync-main-for-push", true],
      ["push-main", true],
      ["close-ticket", true],
      ["push-beads", true],
    ]);
    expect(fake.calls).toEqual([
      "update-main",
      "merge-ticket-branch",
      "final-gates",
      "sync-main-for-push",
      "push-main",
      "close-ticket",
      "push-beads",
    ]);
    expect(fake.maxConcurrent).toBe(1);
  });

  it("invokes merge-fix in the merge worktree after a merge conflict, reruns gates, then closes", async () => {
    const fake = fakeMergeActivities("merge-ticket-branch");
    const result = await runSerializedMergeWorkflow(baseInput(), fake.activities);

    expect(result).toEqual(
      expect.objectContaining({
        status: "merged",
        failedStep: null,
        pushed: true,
        closed: true,
      }),
    );
    expect(fake.calls).toEqual([
      "update-main",
      "merge-ticket-branch",
      "merge-fix",
      "wait-merge-fix",
      "final-gates",
      "sync-main-for-push",
      "push-main",
      "close-ticket",
      "push-beads",
    ]);
    expect(result.steps.map((step) => [step.step, step.ok])).toEqual([
      ["update-main", true],
      ["merge-ticket-branch", false],
      ["merge-fix", true],
      ["wait-merge-fix", true],
      ["final-gates", true],
      ["sync-main-for-push", true],
      ["push-main", true],
      ["close-ticket", true],
      ["push-beads", true],
    ]);
  });

  it("runs merge-fix after final gates fail and reruns deterministic gates before push", async () => {
    const fake = fakeMergeActivities("final-gates", undefined, { failStepLimit: 1 });
    const result = await runSerializedMergeWorkflow(baseInput(), fake.activities);

    expect(result).toEqual(
      expect.objectContaining({
        status: "merged",
        failedStep: null,
        pushed: true,
        closed: true,
      }),
    );
    expect(fake.calls).toEqual([
      "update-main",
      "merge-ticket-branch",
      "final-gates",
      "merge-fix",
      "wait-merge-fix",
      "final-gates",
      "sync-main-for-push",
      "push-main",
      "close-ticket",
      "push-beads",
    ]);
  });

  it("escalates repeated deterministic gate failures to ticket-human without pushing or closing", async () => {
    const fake = fakeMergeActivities("final-gates");
    const result = await runSerializedMergeWorkflow(
      baseInput({ maxMergeFixAttempts: 2 }),
      fake.activities,
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: "failed",
        failedStep: "final-gates",
        pushed: false,
        closed: false,
        humanEscalated: true,
      }),
    );
    expect(fake.calls).toEqual([
      "update-main",
      "merge-ticket-branch",
      "final-gates",
      "merge-fix",
      "wait-merge-fix",
      "final-gates",
      "merge-fix",
      "wait-merge-fix",
      "final-gates",
      "escalate-human",
    ]);
    expect(result.steps.map((step) => [step.step, step.ok])).toEqual([
      ["update-main", true],
      ["merge-ticket-branch", true],
      ["final-gates", false],
      ["merge-fix", true],
      ["wait-merge-fix", true],
      ["final-gates", false],
      ["merge-fix", true],
      ["wait-merge-fix", true],
      ["final-gates", false],
      ["escalate-human", true],
    ]);
  });

  it("does not rerun final gates after a failed merge-fix launch", async () => {
    const fake = fakeMergeActivities("final-gates", undefined, {
      failStepLimit: 1,
      failMergeFix: true,
    });
    const result = await runSerializedMergeWorkflow(baseInput(), fake.activities);

    expect(result).toEqual(
      expect.objectContaining({
        status: "failed",
        failedStep: "final-gates",
        pushed: false,
        closed: false,
        humanEscalated: true,
      }),
    );
    expect(fake.calls).toEqual([
      "update-main",
      "merge-ticket-branch",
      "final-gates",
      "merge-fix",
      "escalate-human",
    ]);
    expect(result.steps.map((step) => [step.step, step.ok])).toEqual([
      ["update-main", true],
      ["merge-ticket-branch", true],
      ["final-gates", false],
      ["merge-fix", false],
      ["escalate-human", true],
    ]);
  });

  it("does not close the ticket when push main fails", async () => {
    const fake = fakeMergeActivities("push-main");
    const result = await runSerializedMergeWorkflow(baseInput(), fake.activities);

    expect(result).toEqual(
      expect.objectContaining({
        status: "failed",
        failedStep: "push-main",
        pushed: false,
        closed: false,
      }),
    );
    expect(fake.calls).toEqual([
      "update-main",
      "merge-ticket-branch",
      "final-gates",
      "sync-main-for-push",
      "push-main",
      "sync-main-for-push",
      "push-main",
      "sync-main-for-push",
      "push-main",
    ]);
  });

  it("fails after closing when Beads sync push fails", async () => {
    const fake = fakeMergeActivities("push-beads");
    const result = await runSerializedMergeWorkflow(baseInput(), fake.activities);

    expect(result).toEqual(
      expect.objectContaining({
        status: "failed",
        failedStep: "push-beads",
        pushed: true,
        closed: true,
      }),
    );
    expect(fake.calls).toEqual([
      "update-main",
      "merge-ticket-branch",
      "final-gates",
      "sync-main-for-push",
      "push-main",
      "close-ticket",
      "push-beads",
    ]);
  });
});

describe("processMergeQueueRequest", () => {
  it("asserts clean main, merges, finalizes Beads, and returns a merged queue result", async () => {
    const fake = fakeMergeQueueActivities();
    const result = await processMergeQueueRequest(queueInput(), queueRequest(), fake.activities);

    expect(result).toEqual(
      expect.objectContaining({
        status: "merged",
        ticketId: "www-queue",
        requestId: "merge_www_queue_abc123",
        pushed: true,
        closed: true,
      }),
    );
    expect(fake.calls).toEqual([
      "assert-clean-main",
      "update-main",
      "merge-ticket-branch",
      "final-gates",
      "sync-main-for-push",
      "push-main",
      "close-ticket",
      "push-beads",
      "resolve-head",
    ]);
  });

  it("human-blocks dirty main before fetch, merge, gates, push, or close", async () => {
    const fake = fakeMergeQueueActivities({ failStep: "assert-clean-main" });
    const result = await processMergeQueueRequest(queueInput(), queueRequest(), fake.activities);

    expect(result).toEqual(
      expect.objectContaining({ status: "human-blocked", failedStep: "assert-clean-main" }),
    );
    expect(fake.calls).toEqual(["assert-clean-main"]);
  });

  it("human-blocks local ahead or diverged main from update-main without merging", async () => {
    const fake = fakeMergeQueueActivities({ failStep: "update-main" });
    const result = await processMergeQueueRequest(queueInput(), queueRequest(), fake.activities);

    expect(result).toEqual(
      expect.objectContaining({ status: "human-blocked", failedStep: "update-main" }),
    );
    expect(fake.calls).toEqual(["assert-clean-main", "update-main"]);
  });

  it("retries a remote-moved push from update-main without force-pushing", async () => {
    const fake = fakeMergeQueueActivities({ failStep: "push-main", failStepLimit: 1 });
    const result = await processMergeQueueRequest(queueInput(), queueRequest(), fake.activities);

    expect(result.status).toBe("merged");
    expect(fake.calls).toEqual([
      "assert-clean-main",
      "update-main",
      "merge-ticket-branch",
      "final-gates",
      "sync-main-for-push",
      "push-main",
      "sync-main-for-push",
      "push-main",
      "close-ticket",
      "push-beads",
      "resolve-head",
    ]);
  });

  it("returns retryable merge conflicts to the ticket workflow without blind queue retries", async () => {
    const fake = fakeMergeQueueActivities({ failStep: "merge-ticket-branch" });
    const result = await processMergeQueueRequest(queueInput(), queueRequest(), fake.activities);

    expect(result).toEqual(
      expect.objectContaining({ status: "retryable-failure", failedStep: "merge-ticket-branch" }),
    );
    expect(fake.calls).toEqual(["assert-clean-main", "update-main", "merge-ticket-branch"]);
  });

  it("returns final gate failures to the ticket workflow without blind queue retries", async () => {
    const fake = fakeMergeQueueActivities({ failStep: "final-gates" });
    const result = await processMergeQueueRequest(queueInput(), queueRequest(), fake.activities);

    expect(result).toEqual(
      expect.objectContaining({ status: "retryable-failure", failedStep: "final-gates" }),
    );
    expect(fake.calls).toEqual([
      "assert-clean-main",
      "update-main",
      "merge-ticket-branch",
      "final-gates",
    ]);
  });

  it("does not rerun git merge after main was pushed but Beads finalization fails", async () => {
    const fake = fakeMergeQueueActivities({ failStep: "close-ticket" });
    const result = await processMergeQueueRequest(queueInput(), queueRequest(), fake.activities);

    expect(result).toEqual(
      expect.objectContaining({ status: "human-blocked", failedStep: "close-ticket" }),
    );
    expect(fake.calls).toEqual([
      "assert-clean-main",
      "update-main",
      "merge-ticket-branch",
      "final-gates",
      "sync-main-for-push",
      "push-main",
      "close-ticket",
    ]);
  });

  it("human-blocks Beads push failure after closing without rerunning git merge", async () => {
    const fake = fakeMergeQueueActivities({ failStep: "push-beads" });
    const result = await processMergeQueueRequest(queueInput(), queueRequest(), fake.activities);

    expect(result).toEqual(
      expect.objectContaining({ status: "human-blocked", failedStep: "push-beads" }),
    );
    expect(fake.calls).toEqual([
      "assert-clean-main",
      "update-main",
      "merge-ticket-branch",
      "final-gates",
      "sync-main-for-push",
      "push-main",
      "close-ticket",
      "push-beads",
    ]);
  });
});

describe("merge queue state", () => {
  it("keeps FIFO order, suppresses duplicates, and snapshots state", () => {
    const state = mergeQueueState();
    const first = queueRequest({
      ticketId: "www-first",
      requestId: "merge_first",
    });
    const second = queueRequest({ ticketId: "www-second", requestId: "merge_second" });

    expect(enqueueMergeQueueRequest(state, first)).toBe("queued");
    expect(enqueueMergeQueueRequest(state, first)).toBe("duplicate");
    expect(enqueueMergeQueueRequest(state, second)).toBe("queued");
    expect(mergeQueueSnapshot(state).queued.map((entry) => entry.request.ticketId)).toEqual([
      "www-first",
      "www-second",
    ]);
  });

  it("suppresses duplicates while active or completed and reports compaction readiness", () => {
    const state = mergeQueueState();
    const request = queueRequest();

    expect(enqueueMergeQueueRequest(state, request)).toBe("queued");
    state.active = state.queued.shift() ?? null;
    expect(enqueueMergeQueueRequest(state, request)).toBe("duplicate");
    recordMergeQueueResult(state, request, {
      status: "merged",
      ticketId: request.ticketId,
      requestId: request.requestId,
      mergeCommitSha: "merge123",
      pushed: true,
      closed: true,
    });
    state.active = null;
    expect(enqueueMergeQueueRequest(state, request)).toBe("duplicate");
    expect(shouldContinueMergeQueueAsNew(state, 1)).toBe(false);
    expect(
      enqueueMergeQueueRequest(
        state,
        queueRequest({ ticketId: "www-next", requestId: "merge_next" }),
      ),
    ).toBe("queued");
    expect(shouldContinueMergeQueueAsNew(state, 1)).toBe(true);
  });

  it("allows a completed ticket to requeue with a new ticket plus commit request id", () => {
    const state = mergeQueueState();
    const request = queueRequest({
      ticketId: "www-retry",
      requestId: "merge_www_retry_oldcommit",
      commitSha: "oldcommit",
    });

    expect(enqueueMergeQueueRequest(state, request)).toBe("queued");
    state.active = state.queued.shift() ?? null;
    recordMergeQueueResult(state, request, {
      status: "retryable-failure",
      ticketId: request.ticketId,
      requestId: request.requestId,
      failedStep: "final-gates",
      attempt: 1,
      reason: "final-gates failed",
      records: [],
    });
    state.active = null;

    expect(enqueueMergeQueueRequest(state, request)).toBe("duplicate");
    expect(
      enqueueMergeQueueRequest(
        state,
        queueRequest({
          ticketId: "www-retry",
          requestId: "merge_www_retry_newcommit",
          commitSha: "newcommit",
        }),
      ),
    ).toBe("queued");
  });

  it("processes the next queued entry and signals the waiting ticket workflow", async () => {
    const state = mergeQueueState();
    const first = queueRequest({
      ticketId: "www-first",
      requestId: "merge_first",
    });
    const second = queueRequest({
      ticketId: "www-second",
      requestId: "merge_second",
    });
    const fake = fakeMergeQueueActivities();
    const signals: unknown[] = [];

    enqueueMergeQueueRequest(state, first);
    enqueueMergeQueueRequest(state, second);

    const result = await processNextMergeQueueEntry(
      queueInput(),
      state,
      fake.activities,
      async (ticketWorkflowId, mergeResult) => {
        signals.push({ ticketWorkflowId, mergeResult });
      },
    );

    expect(result).toEqual(expect.objectContaining({ ticketId: "www-first", status: "merged" }));
    expect(state.active).toBeNull();
    expect(state.completedCount).toBe(1);
    expect(state.queued.map((entry) => entry.request.ticketId)).toEqual(["www-second"]);
    expect(signals).toEqual([
      {
        ticketWorkflowId: "ticket_www-first",
        mergeResult: expect.objectContaining({ ticketId: "www-first", requestId: "merge_first" }),
      },
    ]);
  });
});

function baseInput(overrides: Partial<MergeWorkflowInput> = {}): MergeWorkflowInput {
  const ticketId = overrides.ticketId ?? "www-3agy.11";
  return {
    ticketId,
    repoRoot: "/repo",
    branch: `${ticketId}-ticket-workflow`,
    commitSha: "abc123",
    strategy: "cherry-pick",
    finalGates: [{ label: "test", command: "bun", args: ["run", "test"] }],
    ...overrides,
  };
}

function queueInput(): TicketWorkflowRuntimeConfig {
  return {
    repoRoot: "/repo",
    finalGates: [{ label: "test", command: "bun", args: ["run", "test"] }],
    runtimeLogRoot: "/logs",
    baseRef: "HEAD",
    requirePushedBranch: true,
    mergeStrategy: "merge",
    ticketQueuePollIntervalMs: 15_000,
    maxActiveTicketWorkflows: 3,
    maxTicketsPerPoll: 3,
    maxMergeAttempts: 3,
    maxMergeHistoryEvents: 100,
    stuckTicketRecoveryPollIntervalMs: 60_000,
    stuckTicketRecoveryMaxTicketsPerPoll: 10,
    temporalAddress: "127.0.0.1:7233",
    temporalNamespace: "project-management",
  };
}

function queueRequest(overrides: Partial<MergeQueueRequest> = {}): MergeQueueRequest {
  return {
    requestId: "merge_www_queue_abc123",
    ticketId: "www-queue",
    branch: "www-queue-queue-ticket",
    commitSha: "abc123",
    strategy: "merge",
    requestedAt: "2026-06-19T00:00:00.000Z",
    ...overrides,
  };
}

function mergeQueueState(): MergeQueueMutableState {
  return { queued: [], active: null, completedCount: 0, completed: new Map() };
}

function fakeMergeQueueActivities(
  options: { readonly failStep?: string; readonly failStepLimit?: number } = {},
): { readonly activities: MergeQueueActivities; readonly calls: string[] } {
  const calls: string[] = [];
  let matchingFailures = 0;
  const run = async (step: string): Promise<MergeActivityResult> => {
    calls.push(step);
    const shouldFail = step === options.failStep;
    if (shouldFail) matchingFailures += 1;
    const ok =
      !shouldFail || matchingFailures > (options.failStepLimit ?? Number.POSITIVE_INFINITY);
    return {
      ok,
      records: ok
        ? []
        : [
            {
              activity: step,
              command: { command: step, args: [] },
              exitCode: 1,
              stdout: "",
              stderr: `${step} failed`,
            },
          ],
    };
  };
  return {
    calls,
    activities: {
      assertCleanMainActivity: async () => run("assert-clean-main"),
      updateMainActivity: async () => run("update-main"),
      mergeTicketBranchActivity: async () => run("merge-ticket-branch"),
      runFinalGatesActivity: async () => run("final-gates"),
      syncMainForPushActivity: async () => run("sync-main-for-push"),
      pushMainActivity: async () => run("push-main"),
      closeTicketActivity: async () => run("close-ticket"),
      pushBeadsActivity: async () => run("push-beads"),
      resolveGitHeadActivity: async () => {
        calls.push("resolve-head");
        return { ok: true, commitSha: "merge123", records: [] };
      },
      readVerifiedMergeQueueActivity: async () => [],
      loadTicketWorkflowConfigActivity: async () => queueInput(),
      loadTicketWorkflowTicketDetailsActivity: async (input) => ({
        ticketId: input.ticketId,
        title: "Queue ticket",
        acceptanceCriteria: "- [ ] queue passes",
        comments: [],
      }),
      escalateTicketHumanActivity: async () => run("escalate-human"),
      startTicketMergeFixActivity: async () => ({
        sessionName: "ticket_www-queue_mergefix_1",
        startedAtMs: 1,
        stdoutLogPath: "/tmp/stdout",
        stderrLogPath: "/tmp/stderr",
        exitCodePath: "/tmp/exit",
        records: [],
        agent: "ticket-mergefix",
        model: "openai/gpt-5.5",
        promptPath: "/tmp/prompt",
      }),
      waitForAgentRunCompletionActivity: async () => ({
        sessionName: "ticket_www-queue_mergefix_1",
        completed: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        records: [],
      }),
    },
  };
}

function fakeMergeActivities(
  failStep?: MergeWorkflowStep,
  failTicketId?: string,
  options: { readonly failStepLimit?: number; readonly failMergeFix?: boolean } = {},
): {
  readonly activities: MergeWorkflowActivities;
  readonly calls: MergeWorkflowStep[];
  readonly maxConcurrent: number;
} {
  const calls: MergeWorkflowStep[] = [];
  let active = 0;
  let maxConcurrent = 0;

  let currentTicketId: string | null = null;
  let matchingFailures = 0;

  async function run(step: MergeWorkflowStep, ticketId: string): Promise<MergeActivityResult> {
    active += 1;
    maxConcurrent = Math.max(maxConcurrent, active);
    currentTicketId = ticketId;
    calls.push(step);
    await Promise.resolve();
    active -= 1;
    const ticketMatches =
      failTicketId === undefined ||
      ticketId === failTicketId ||
      ticketId.startsWith(`${failTicketId}-`);
    const stepShouldFail = step === failStep && ticketMatches;
    const mergeFixShouldFail =
      options.failMergeFix === true && step === "merge-fix" && ticketMatches;
    if (stepShouldFail) matchingFailures += 1;
    return {
      ok: !(
        mergeFixShouldFail ||
        (stepShouldFail &&
          (options.failStepLimit === undefined || matchingFailures <= options.failStepLimit))
      ),
      records: [],
    };
  }

  return {
    calls,
    get maxConcurrent() {
      return maxConcurrent;
    },
    activities: {
      updateMainActivity: async () => run("update-main", currentTicketId ?? ""),
      mergeTicketBranchActivity: async (input) => run("merge-ticket-branch", input.branch),
      runFinalGatesActivity: async () => run("final-gates", currentTicketId ?? ""),
      syncMainForPushActivity: async () => run("sync-main-for-push", currentTicketId ?? ""),
      pushMainActivity: async () => run("push-main", currentTicketId ?? ""),
      closeTicketActivity: async (input) => run("close-ticket", input.ticketId),
      pushBeadsActivity: async () => run("push-beads", currentTicketId ?? ""),
      startTicketMergeFixActivity: async (input) => {
        const result = await run("merge-fix", input.ticketId);
        return {
          ...result,
          records: [
            {
              activity: "start-tmux-command",
              command: { command: "tmux", args: ["new-session"], cwd: input.repoRoot },
              exitCode: result.ok ? 0 : 1,
              stdout: "",
              stderr: result.ok ? "" : "tmux failed",
            },
          ],
          sessionName: `ticket_${input.ticketId}_mergefix_${input.attempt}`,
          startedAtMs: 3000,
          stdoutLogPath: "/tmp/mergefix.stdout.log",
          stderrLogPath: "/tmp/mergefix.stderr.log",
          exitCodePath: "/tmp/mergefix.exitcode",
          agent: "ticket-mergefix",
          model: "openai/gpt-5.5",
          promptPath: "/tmp/mergefix.prompt.md",
        };
      },
      waitForAgentRunCompletionActivity: async (input) => {
        calls.push("wait-merge-fix");
        return {
          sessionName: input.sessionName,
          completed: true,
          exitCode: 0,
          stdout: "",
          stderr: "",
          records: [],
        };
      },
      escalateTicketHumanActivity: async (input) => run("escalate-human", input.ticketId),
    },
  };
}
