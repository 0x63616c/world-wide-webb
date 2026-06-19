import { describe, expect, it } from "vitest";
import type { MergeActivityResult } from "./command-activities";
import {
  type MergeWorkflowActivities,
  type MergeWorkflowInput,
  type MergeWorkflowStep,
  runSerializedMergeQueueWorkflow,
  runSerializedMergeWorkflow,
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
      "push-main",
      "close-ticket",
      "update-main",
      "merge-ticket-branch",
      "final-gates",
      "merge-fix",
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
      ["push-main", true],
      ["close-ticket", true],
    ]);
    expect(fake.calls).toEqual([
      "update-main",
      "merge-ticket-branch",
      "final-gates",
      "push-main",
      "close-ticket",
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
      "final-gates",
      "push-main",
      "close-ticket",
    ]);
    expect(result.steps.map((step) => [step.step, step.ok])).toEqual([
      ["update-main", true],
      ["merge-ticket-branch", false],
      ["merge-fix", true],
      ["final-gates", true],
      ["push-main", true],
      ["close-ticket", true],
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
      "final-gates",
      "push-main",
      "close-ticket",
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
      "final-gates",
      "merge-fix",
      "final-gates",
      "escalate-human",
    ]);
    expect(result.steps.map((step) => [step.step, step.ok])).toEqual([
      ["update-main", true],
      ["merge-ticket-branch", true],
      ["final-gates", false],
      ["merge-fix", true],
      ["final-gates", false],
      ["merge-fix", true],
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
    expect(fake.calls).toEqual(["update-main", "merge-ticket-branch", "final-gates", "push-main"]);
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
      pushMainActivity: async () => run("push-main", currentTicketId ?? ""),
      closeTicketActivity: async (input) => run("close-ticket", input.ticketId),
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
          stdoutLogPath: "/tmp/mergefix.stdout.log",
          stderrLogPath: "/tmp/mergefix.stderr.log",
          agent: "ticket-mergefix",
          model: "openai/gpt-5.5",
          promptPath: "/tmp/mergefix.prompt.md",
        };
      },
      escalateTicketHumanActivity: async (input) => run("escalate-human", input.ticketId),
    },
  };
}
