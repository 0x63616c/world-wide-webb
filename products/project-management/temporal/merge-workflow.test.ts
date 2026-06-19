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

  it("does not run gates, push main, or close the ticket after a merge conflict", async () => {
    const fake = fakeMergeActivities("merge-ticket-branch");
    const result = await runSerializedMergeWorkflow(baseInput(), fake.activities);

    expect(result).toEqual(
      expect.objectContaining({
        status: "failed",
        failedStep: "merge-ticket-branch",
        pushed: false,
        closed: false,
      }),
    );
    expect(fake.calls).toEqual(["update-main", "merge-ticket-branch"]);
    expect(result.steps.map((step) => [step.step, step.ok])).toEqual([
      ["update-main", true],
      ["merge-ticket-branch", false],
    ]);
  });

  it("runs final gates on main before push and does not close the ticket when gates fail", async () => {
    const fake = fakeMergeActivities("final-gates");
    const result = await runSerializedMergeWorkflow(baseInput(), fake.activities);

    expect(result).toEqual(
      expect.objectContaining({
        status: "failed",
        failedStep: "final-gates",
        pushed: false,
        closed: false,
      }),
    );
    expect(fake.calls).toEqual(["update-main", "merge-ticket-branch", "final-gates"]);
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
): {
  readonly activities: MergeWorkflowActivities;
  readonly calls: MergeWorkflowStep[];
  readonly maxConcurrent: number;
} {
  const calls: MergeWorkflowStep[] = [];
  let active = 0;
  let maxConcurrent = 0;

  let currentTicketId: string | null = null;

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
    return { ok: !(step === failStep && ticketMatches), records: [] };
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
    },
  };
}
