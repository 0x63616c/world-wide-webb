import { describe, expect, it } from "vitest";
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
      ["start-builder", true],
      ["wait-builder", true],
      ["resolve-commit", true],
      ["write-builder-metadata", true],
      ["verify-builder-handoff", true],
      ["start-reviewer", true],
      ["wait-reviewer", true],
      ["verify-reviewer-handoff", true],
      ["merge", true],
    ]);
    expect(fake.calls).toEqual([
      "claim",
      "create-worktree",
      "start-builder",
      "wait:ticket_www-proof_build_1",
      "resolve-head",
      "write-metadata:review:abc123",
      "verify-builder-handoff",
      "start-reviewer",
      "wait:ticket_www-proof_review_1",
      "verify-reviewer-handoff",
      "update-main",
      "merge-ticket-branch:merge",
      "final-gates",
      "push-main",
      "close-ticket",
    ]);
  });

  it("loops retries and escalates human when reviewer keeps requesting retry", async () => {
    const fake = fakeRunnerActivities({ reviewerHandoff: "retry" });
    const result = await runTicketWorkflowRunner(baseInput(), fake.activities);

    expect(result.status).toBe("human");
    expect(fake.calls).toContain("verify-reviewer-handoff");
    expect(fake.calls.filter((call) => call === "start-builder")).toHaveLength(2);
    expect(fake.calls).toContain("escalate-human");
    expect(fake.calls).not.toContain("push-main");
    expect(fake.calls).not.toContain("close-ticket");
  });
});

function baseInput(): TicketWorkflowRunnerInput {
  return {
    ticketId: "www-proof",
    title: "Proof ticket",
    repoRoot: "/repo",
    acceptanceCriteria: "- [ ] proof passes",
    finalGates: [{ label: "test", command: "bun", args: ["run", "test"] }],
  };
}

function fakeRunnerActivities(
  options: {
    readonly reviewerHandoff?: "verified" | "retry" | "human" | "missing" | "ambiguous";
  } = {},
): {
  readonly activities: TicketWorkflowRunnerActivities;
  readonly calls: string[];
} {
  const calls: string[] = [];
  const ok = (): MergeActivityResult => ({ ok: true, records: [] });

  return {
    calls,
    activities: {
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
      startTicketBuilderActivity: async () => {
        calls.push("start-builder");
        return {
          sessionName: "ticket_www-proof_build_1",
          stdoutLogPath: "/logs/build.stdout.log",
          stderrLogPath: "/logs/build.stderr.log",
          exitCodePath: "/logs/build.exitcode",
          records: [],
          agent: "ticket-builder",
          model: "openai/gpt-5.5",
          promptPath: "/logs/build.prompt.md",
        };
      },
      startTicketReviewerActivity: async () => {
        calls.push("start-reviewer");
        return {
          sessionName: "ticket_www-proof_review_1",
          stdoutLogPath: "/logs/review.stdout.log",
          stderrLogPath: "/logs/review.stderr.log",
          exitCodePath: "/logs/review.exitcode",
          records: [],
          agent: "ticket-reviewer",
          model: "openai/gpt-5.5-fast",
          promptPath: "/logs/review.prompt.md",
        };
      },
      waitForTmuxSessionActivity: async (input) => {
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
      writeTicketWorkflowMetadataActivity: async (input) => {
        calls.push(`write-metadata:${input.metadata.phase}:${input.metadata.commit}`);
        return ok();
      },
      verifyBuilderHandoffActivity: async () => {
        calls.push("verify-builder-handoff");
        return {
          ...ok(),
          handoff: "review",
          labels: ["ticket-review"],
          hasBuilderComment: true,
        };
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
      pushMainActivity: async () => {
        calls.push("push-main");
        return ok();
      },
      closeTicketActivity: async () => {
        calls.push("close-ticket");
        return ok();
      },
      escalateTicketHumanActivity: async () => {
        calls.push("escalate-human");
        return ok();
      },
      startTicketMergeFixActivity: async () => ({
        sessionName: "ticket_www-proof_mergefix_1",
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
