import { describe, expect, it } from "vitest";
import type { TicketWorkflowMetadata } from "../beads-adapter";
import type { MergeActivityResult } from "./command-activities";
import {
  runTicketWorkflowRunner,
  type TicketWorkflowRunnerActivities,
  type TicketWorkflowRunnerInput,
} from "./workflows";

describe("runTicketWorkflowRunner", () => {
  it("claims, builds, reviews, verifies, and merges a proof ticket through activity boundaries", async () => {
    const fake = fakeRunnerActivities();
    const result = await runTicketWorkflowRunner(baseInput(), fake.activities);

    expect(result).toEqual(
      expect.objectContaining({
        ticketId: "www-proof",
        status: "merged",
        branch: "www-proof-proof-ticket",
        worktreePath: "/repo/.worktrees/tickets/www-proof-proof-ticket",
        commitSha: "abc123",
        builderSessionName: "ticket_www-proof_build_1",
        reviewerSessionName: "ticket_www-proof_review_1",
      }),
    );
    expect(result.steps.map((step) => [step.step, step.ok])).toEqual([
      ["claim-ticket", true],
      ["create-worktree", true],
      ["prepare-worktree", true],
      ["start-builder", true],
      ["write-builder-start-metadata", true],
      ["wait-builder", true],
      ["resolve-builder-session", true],
      ["capture-builder-usage", true],
      ["resolve-commit", true],
      ["write-builder-completion-metadata", true],
      ["verify-builder-handoff", true],
      ["validate-builder", true],
      ["move-ticket-review", true],
      ["start-reviewer", true],
      ["write-reviewer-start-metadata", true],
      ["wait-reviewer", true],
      ["resolve-reviewer-session", true],
      ["capture-reviewer-usage", true],
      ["verify-reviewer-handoff", true],
      ["write-reviewer-completion-metadata", true],
      ["merge", true],
    ]);
    expect(fake.calls).toEqual([
      "claim",
      "create-worktree",
      "prepare-worktree",
      "start-builder",
      "write-metadata:builder-started:build:1:ticket_www-proof_build_1:/logs/build.prompt.md:/logs/build.stdout.log:/logs/build.stderr.log",
      "wait:ticket_www-proof_build_1",
      "resolve-session:ticket-builder:1000",
      "capture-usage:builder:ses_builder",
      "resolve-head",
      "write-metadata:builder-passed:review:1:ticket_www-proof_build_1:/logs/build.prompt.md:/logs/build.stdout.log:/logs/build.stderr.log",
      "verify-builder-handoff",
      "validate-builder",
      "move-ticket-review",
      "start-reviewer",
      "write-metadata:reviewer-started:review:1:ticket_www-proof_review_1:/logs/review.prompt.md:/logs/review.stdout.log:/logs/review.stderr.log",
      "wait:ticket_www-proof_review_1",
      "resolve-session:ticket-reviewer:2000",
      "capture-usage:reviewer:ses_reviewer",
      "verify-reviewer-handoff",
      "write-metadata:reviewer-verified:verified:1:ticket_www-proof_review_1:/logs/review.prompt.md:/logs/review.stdout.log:/logs/review.stderr.log",
      "update-main",
      "merge-ticket-branch:merge",
      "final-gates",
      "sync-main-for-push",
      "push-main",
      "close-ticket",
      "push-beads",
    ]);
    expect(fake.metadata).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: "build",
          attempt: 1,
          branch: "www-proof-proof-ticket",
          worktree: "/repo/.worktrees/tickets/www-proof-proof-ticket",
          tmuxSession: "ticket_www-proof_build_1",
          promptPath: "/logs/build.prompt.md",
          stdoutLog: "/logs/build.stdout.log",
          stderrLog: "/logs/build.stderr.log",
          lastResult: "builder-started",
        }),
        expect.objectContaining({
          phase: "review",
          tmuxSession: "ticket_www-proof_review_1",
          promptPath: "/logs/review.prompt.md",
          stdoutLog: "/logs/review.stdout.log",
          stderrLog: "/logs/review.stderr.log",
          lastResult: "reviewer-started",
        }),
        expect.objectContaining({
          phase: "verified",
          openCodeSession: "Review proof ticket (ses_reviewer)",
          commit: "abc123",
          lastResult: "reviewer-verified",
        }),
      ]),
    );
  });

  it("loops retries and escalates human when reviewer keeps requesting retry", async () => {
    const fake = fakeRunnerActivities({ reviewerHandoff: "retry" });
    const result = await runTicketWorkflowRunner(baseInput(), fake.activities);

    expect(result.status).toBe("human");
    expect(fake.calls).toContain("verify-reviewer-handoff");
    expect(fake.calls.filter((call) => call === "start-builder")).toHaveLength(3);
    expect(fake.calls).toContain("resume-builder:ses_builder");
    expect(fake.calls).toContain("escalate-human");
    expect(fake.calls).toContain(
      "escalate-reason:Ticket workflow stopped because the reviewer attempt limit was hit (3 attempt(s)).",
    );
    expect(fake.calls).not.toContain("push-main");
    expect(fake.calls).not.toContain("close-ticket");
  });

  it("enqueues reviewer-verified tickets to the merge queue instead of merging inline", async () => {
    const fake = fakeRunnerActivities();
    const requests: unknown[] = [];
    const result = await runTicketWorkflowRunner(baseInput(), fake.activities, {
      enqueueAndWait: async (request) => {
        requests.push(request);
        return {
          status: "merged",
          ticketId: request.ticketId,
          requestId: request.requestId,
          mergeCommitSha: "merge123",
          pushed: true,
          closed: true,
        };
      },
    });

    expect(result.status).toBe("merged");
    expect(requests).toEqual([
      expect.objectContaining({
        ticketId: "www-proof",
        branch: "www-proof-proof-ticket",
        commitSha: "abc123",
        strategy: "merge",
      }),
    ]);
    expect(fake.calls).not.toContain("update-main");
    expect(fake.calls).not.toContain("push-main");
  });

  it("handles retryable merge queue results as failed ticket workflow results", async () => {
    const fake = fakeRunnerActivities();
    const result = await runTicketWorkflowRunner(baseInput(), fake.activities, {
      enqueueAndWait: async (request) => ({
        status: "retryable-failure",
        ticketId: request.ticketId,
        requestId: request.requestId,
        failedStep: "push-main",
        attempt: 1,
        reason: "remote moved",
        records: [],
      }),
    });

    expect(result.status).toBe("human");
    expect(fake.calls.filter((call) => call === "start-builder")).toHaveLength(3);
    expect(fake.calls).toContain("requeue-ticket");
  });

  it("handles human-blocked merge queue results as human ticket workflow results", async () => {
    const fake = fakeRunnerActivities();
    const result = await runTicketWorkflowRunner(baseInput(), fake.activities, {
      enqueueAndWait: async (request) => ({
        status: "human-blocked",
        ticketId: request.ticketId,
        requestId: request.requestId,
        failedStep: "final-gates",
        reason: "gates exhausted",
      }),
    });

    expect(result.status).toBe("human");
    expect(result.mergeResult).toEqual(
      expect.objectContaining({ failedStep: "final-gates", humanEscalated: true }),
    );
  });
});

function baseInput(): TicketWorkflowRunnerInput {
  return {
    ticketId: "www-proof",
  };
}

function fakeRunnerActivities(
  options: {
    readonly reviewerHandoff?: "verified" | "retry" | "human" | "missing" | "ambiguous";
  } = {},
): {
  readonly activities: TicketWorkflowRunnerActivities;
  readonly calls: string[];
  readonly metadata: TicketWorkflowMetadata[];
} {
  const calls: string[] = [];
  const metadata: TicketWorkflowMetadata[] = [];
  const ok = (): MergeActivityResult => ({ ok: true, records: [] });

  return {
    calls,
    metadata,
    activities: {
      loadTicketWorkflowConfigActivity: async () => ({
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
      }),
      loadTicketWorkflowTicketDetailsActivity: async () => ({
        ticketId: "www-proof",
        title: "Proof ticket",
        acceptanceCriteria: "- [ ] proof passes",
        comments: [],
      }),
      claimTicketActivity: async () => {
        calls.push("claim");
        return ok();
      },
      createTicketWorktreeActivity: async () => {
        calls.push("create-worktree");
        return {
          branchName: "www-proof-proof-ticket",
          worktreePath: "/repo/.worktrees/tickets/www-proof-proof-ticket",
          slug: "proof-ticket",
          records: [],
        };
      },
      prepareTicketWorktreeActivity: async () => {
        calls.push("prepare-worktree");
        return ok();
      },
      startTicketBuilderActivity: async (input) => {
        if (input.resumeSessionId) calls.push(`resume-builder:${input.resumeSessionId}`);
        calls.push("start-builder");
        return {
          sessionName: "ticket_www-proof_build_1",
          startedAtMs: 1000,
          stdoutLogPath: "/logs/build.stdout.log",
          stderrLogPath: "/logs/build.stderr.log",
          exitCodePath: "/logs/build.exitcode",
          records: [],
          agent: "ticket-builder",
          model: "openai/gpt-5.5-fast",
          promptPath: "/logs/build.prompt.md",
        };
      },
      startTicketReviewerActivity: async (input) => {
        if (input.resumeSessionId) calls.push(`resume-reviewer:${input.resumeSessionId}`);
        calls.push("start-reviewer");
        return {
          sessionName: "ticket_www-proof_review_1",
          startedAtMs: 2000,
          stdoutLogPath: "/logs/review.stdout.log",
          stderrLogPath: "/logs/review.stderr.log",
          exitCodePath: "/logs/review.exitcode",
          records: [],
          agent: "ticket-reviewer",
          model: "openai/gpt-5.5-fast",
          promptPath: "/logs/review.prompt.md",
        };
      },
      waitForAgentRunCompletionActivity: async (input) => {
        calls.push(`wait:${input.sessionName}`);
        return {
          sessionName: input.sessionName,
          completed: true,
          exitCode: 0,
          stdout: input.sessionName.includes("review") ? "Reviewer completed" : "Builder summary",
          stderr: "",
          records: [],
        };
      },
      resolveGitHeadActivity: async () => {
        calls.push("resolve-head");
        return { ok: true, commitSha: "abc123", records: [] };
      },
      resolveOpenCodeSessionActivity: async (input) => {
        calls.push(`resolve-session:${input.agent}:${input.startedAfterMs}`);
        const sessionId = input.agent === "ticket-builder" ? "ses_builder" : input.agent === "ticket-reviewer" ? "ses_reviewer" : "ses_mergefix";
        return {
          ok: true,
          sessionId,
          title: input.agent === "ticket-builder" ? "Proof ticket" : input.agent === "ticket-reviewer" ? "Review proof ticket" : "Merge fix proof ticket",
          records: [],
        };
      },
      captureOpenCodeUsageActivity: async (input) => {
        calls.push(`capture-usage:${input.role}:${input.opencodeSessionId}`);
        return {
          ok: true,
          usage: {
            sessionId: input.opencodeSessionId ?? "",
            title: null,
            agent: null,
            model: null,
            costUsd: 0,
            tokensInput: 0,
            tokensOutput: 0,
            tokensReasoning: 0,
            tokensCacheRead: 0,
            tokensCacheWrite: 0,
          },
        };
      },
      writeTicketWorkflowMetadataActivity: async (input) => {
        metadata.push(input.metadata);
        calls.push(
          `write-metadata:${input.metadata.lastResult}:${input.metadata.phase}:${input.metadata.attempt}:${input.metadata.tmuxSession}:${input.metadata.promptPath}:${input.metadata.stdoutLog}:${input.metadata.stderrLog}`,
        );
        return ok();
      },
      verifyBuilderHandoffActivity: async () => {
        calls.push("verify-builder-handoff");
        return {
          ...ok(),
          handoff: "review",
          labels: ["ticket-ready"],
          hasBuilderComment: true,
        };
      },
      moveTicketToReviewActivity: async () => {
        calls.push("move-ticket-review");
        return ok();
      },
      validateTicketImplementationActivity: async () => {
        calls.push("validate-builder");
        return ok();
      },
      writeTicketCommentActivity: async (input) => {
        calls.push(`write-comment:${input.kind}`);
        return ok();
      },
      requeueTicketActivity: async () => {
        calls.push("requeue-ticket");
        return ok();
      },
      verifyReviewerHandoffActivity: async () => {
        calls.push("verify-reviewer-handoff");
        return {
          ...ok(),
          handoff: options.reviewerHandoff ?? "verified",
          labels: [options.reviewerHandoff === "retry" ? "ticket-retry" : "ticket-verified"],
          hasReviewerComment: true,
        };
      },
      updateMainActivity: async () => {
        calls.push("update-main");
        return ok();
      },
      mergeTicketBranchActivity: async (input) => {
        calls.push(`merge-ticket-branch:${input.strategy}`);
        return ok();
      },
      runFinalGatesActivity: async () => {
        calls.push("final-gates");
        return ok();
      },
      syncMainForPushActivity: async () => {
        calls.push("sync-main-for-push");
        return ok();
      },
      pushMainActivity: async () => {
        calls.push("push-main");
        return ok();
      },
      closeTicketActivity: async () => {
        calls.push("close-ticket");
        return ok();
      },
      pushBeadsActivity: async () => {
        calls.push("push-beads");
        return ok();
      },
      escalateTicketHumanActivity: async (input) => {
        calls.push("escalate-human");
        calls.push(`escalate-reason:${input.reason}`);
        return ok();
      },
      startTicketMergeFixActivity: async () => ({
        sessionName: "ticket_www-proof_mergefix_1",
        startedAtMs: 3000,
        stdoutLogPath: "/logs/mergefix.stdout.log",
        stderrLogPath: "/logs/mergefix.stderr.log",
        exitCodePath: "/logs/mergefix.exitcode",
        records: [],
        agent: "ticket-mergefix",
        model: "openai/gpt-5.5",
        promptPath: "/logs/mergefix.prompt.md",
      }),
    },
  };
}
