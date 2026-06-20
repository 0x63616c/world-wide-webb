import { describe, expect, it } from "vitest";
import { runStuckTicketRecoveryBatch, type StuckTicketRecoveryWorkflowInput } from "./workflows";

const input = {
  repoRoot: "/repo",
  runtimeLogRoot: "/logs",
  temporalAddress: "127.0.0.1:7233",
  temporalNamespace: "project-management",
  maxTicketsPerPoll: 2,
} as const satisfies StuckTicketRecoveryWorkflowInput;

describe("runStuckTicketRecoveryBatch", () => {
  it("limits each poll to the configured batch size", async () => {
    const inspected: string[] = [];
    const recovered: string[] = [];
    const result = await runStuckTicketRecoveryBatch(input, candidates("www-a", "www-b", "www-c"), {
      readStuckTicketRecoveryCandidatesActivity: async () => [],
      inspectTicketWorkflowExecutionActivity: async ({ workflowId }) => {
        inspected.push(workflowId);
        return { status: "missing", detail: "not found" };
      },
      recoverStuckTicketActivity: async ({ candidate }) => {
        recovered.push(candidate.ticketId);
        return recoveryResult(candidate.ticketId, true);
      },
    });

    expect(inspected).toEqual(["ticket_www-a", "ticket_www-b"]);
    expect(recovered).toEqual(["www-a", "www-b"]);
    expect(result).toEqual({ recovered: ["www-a", "www-b"], skippedLive: [], failed: [] });
  });

  it("skips tickets with live ticket workflows", async () => {
    const recovered: string[] = [];
    const result = await runStuckTicketRecoveryBatch(input, candidates("www-live", "www-dead"), {
      readStuckTicketRecoveryCandidatesActivity: async () => [],
      inspectTicketWorkflowExecutionActivity: async ({ workflowId }) =>
        workflowId === "ticket_www-live"
          ? { status: "running", detail: "running" }
          : { status: "closed", detail: "completed" },
      recoverStuckTicketActivity: async ({ candidate }) => {
        recovered.push(candidate.ticketId);
        return recoveryResult(candidate.ticketId, true);
      },
    });

    expect(recovered).toEqual(["www-dead"]);
    expect(result).toEqual({ recovered: ["www-dead"], skippedLive: ["www-live"], failed: [] });
  });

  it("reports cleanup failures without blocking other recoveries", async () => {
    const result = await runStuckTicketRecoveryBatch(
      input,
      candidates("www-missing", "www-fails"),
      {
        readStuckTicketRecoveryCandidatesActivity: async () => [],
        inspectTicketWorkflowExecutionActivity: async () => ({
          status: "missing",
          detail: "not found",
        }),
        recoverStuckTicketActivity: async ({ candidate }) =>
          recoveryResult(candidate.ticketId, candidate.ticketId !== "www-fails"),
      },
    );

    expect(result).toEqual({ recovered: ["www-missing"], skippedLive: [], failed: ["www-fails"] });
  });
});

function candidates(...ticketIds: readonly string[]) {
  return ticketIds.map((ticketId) => ({
    ticketId,
    title: ticketId,
    workflowId: `ticket_${ticketId}`,
    reason: "ticket has workflow-owned label",
    branch: `${ticketId}-branch`,
    worktree: `/repo/.worktrees/tickets/${ticketId}-branch`,
    tmuxSession: `ticket_${ticketId}_build_1`,
    promptPath: "",
    stdoutLog: "",
    stderrLog: "",
  }));
}

function recoveryResult(ticketId: string, ok: boolean) {
  return {
    ticketId,
    ok,
    plan: {
      ticketId,
      actions: [],
      reportedTmuxSessions: [],
      preservedEvidencePaths: [],
      ignoredWorktreePaths: [],
      ignoredLocalBranches: [],
      ignoredRemoteBranches: [],
      ignoredTmuxSessions: [],
      ignoredEvidenceFileNames: [],
    },
    cleanup: [],
    records: [],
  };
}
