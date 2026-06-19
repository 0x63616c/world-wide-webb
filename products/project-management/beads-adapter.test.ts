import { describe, expect, it } from "vitest";
import {
  BeadsAdapter,
  type BeadsCommand,
  buildCommentCommand,
  buildDownstreamBlockedProbeCommand,
  buildFailedReviewRequeueCommand,
  buildMetadataCommand,
  buildQueueCommand,
  buildShowTicketsCommand,
  isDownstreamBlockedProbeResult,
  TICKET_METADATA_KEYS,
  TICKET_QUEUE_LABELS,
  TICKET_WORKFLOW_LABELS,
  type TicketWorkflowMetadata,
} from "./beads-adapter";

const metadata: TicketWorkflowMetadata = {
  phase: "builder",
  attempt: 2,
  branch: "www-3agy-ticket-workflow",
  worktree: "/repo/.claude/worktrees/www-3agy-ticket-workflow",
  tmuxSession: "tmux_www_3agy",
  promptPath: "/cache/ticket.prompt.md",
  stdoutLog: "/cache/ticket.stdout.log",
  stderrLog: "/cache/ticket.stderr.log",
  openCodeSession: "ses_abc123",
  commit: "abc1234",
  lastResult: "review-failed",
};

describe("ticket workflow labels", () => {
  it("defines the workflow labels used by Beads queues", () => {
    expect(TICKET_WORKFLOW_LABELS).toEqual({
      ready: "ticket-ready",
      review: "ticket-review",
      verified: "ticket-verified",
      retry: "ticket-retry",
      human: "ticket-human",
    });
    expect(TICKET_QUEUE_LABELS).toEqual({
      builder: "ticket-ready",
      review: "ticket-review",
      verified: "ticket-verified",
      human: "ticket-human",
    });
  });
});

describe("buildQueueCommand", () => {
  it("exposes the builder queue from ticket-ready without treating ticket-human as ready work", () => {
    expect(buildQueueCommand("builder")).toEqual({
      command: "bd",
      args: [
        "list",
        "--json",
        "--no-pager",
        "-n",
        "0",
        "--status",
        "open",
        "--label",
        "ticket-ready",
        "--ready",
        "--exclude-label",
        "ticket-human",
      ],
    });
  });

  it("exposes review, verified, and human queues from their labels", () => {
    expect(buildQueueCommand("review").args).toContain("ticket-review");
    expect(buildQueueCommand("verified").args).toContain("ticket-verified");
    expect(buildQueueCommand("human").args).toContain("ticket-human");
    expect(buildQueueCommand("human").args).not.toContain("--ready");
  });
});

describe("metadata and comments", () => {
  it("writes all workflow metadata fields as Beads metadata", () => {
    expect(buildMetadataCommand("www-3agy.4", metadata)).toEqual({
      command: "bd",
      args: [
        "update",
        "www-3agy.4",
        "--set-metadata",
        `${TICKET_METADATA_KEYS.phase}=builder`,
        "--set-metadata",
        `${TICKET_METADATA_KEYS.attempt}=2`,
        "--set-metadata",
        `${TICKET_METADATA_KEYS.attempts}=2`,
        "--set-metadata",
        `${TICKET_METADATA_KEYS.branch}=www-3agy-ticket-workflow`,
        "--set-metadata",
        `${TICKET_METADATA_KEYS.worktree}=/repo/.claude/worktrees/www-3agy-ticket-workflow`,
        "--set-metadata",
        `${TICKET_METADATA_KEYS.tmuxSession}=tmux_www_3agy`,
        "--set-metadata",
        `${TICKET_METADATA_KEYS.promptPath}=/cache/ticket.prompt.md`,
        "--set-metadata",
        `${TICKET_METADATA_KEYS.stdoutLog}=/cache/ticket.stdout.log`,
        "--set-metadata",
        `${TICKET_METADATA_KEYS.stderrLog}=/cache/ticket.stderr.log`,
        "--set-metadata",
        `${TICKET_METADATA_KEYS.openCodeSession}=ses_abc123`,
        "--set-metadata",
        `${TICKET_METADATA_KEYS.commit}=abc1234`,
        "--set-metadata",
        `${TICKET_METADATA_KEYS.lastResult}=review-failed`,
      ],
    });
  });

  it("writes builder summary, reviewer findings, and escalation comments", () => {
    expect(buildCommentCommand("www-3agy.4", "builder-summary", "Built adapter")).toEqual({
      command: "bd",
      args: ["comment", "www-3agy.4", "--stdin"],
      stdin: "## Builder summary\n\nBuilt adapter",
    });
    expect(buildCommentCommand("www-3agy.4", "reviewer-findings", "Finding list").stdin).toBe(
      "## Reviewer findings\n\nFinding list",
    );
    expect(buildCommentCommand("www-3agy.4", "escalation", "Needs Calum").stdin).toBe(
      "## Escalation\n\nNeeds Calum",
    );
  });

  it("builds a failed-review requeue command for ticket-ready plus ticket-retry", () => {
    expect(buildFailedReviewRequeueCommand("www-3agy.10")).toEqual({
      command: "bd",
      args: [
        "update",
        "www-3agy.10",
        "--add-label",
        "ticket-ready",
        "--add-label",
        "ticket-retry",
        "--remove-label",
        "ticket-review",
        "--remove-label",
        "ticket-verified",
      ],
    });
  });
});

describe("BeadsAdapter", () => {
  it("runs queue, metadata, and comment commands through the injected boundary", async () => {
    const commands: BeadsCommand[] = [];
    const adapter = new BeadsAdapter(async (command) => {
      commands.push(command);
      return JSON.stringify([
        { id: "www-3agy.4", title: "Define adapter", status: "open", labels: ["ticket-ready"] },
      ]);
    });

    await expect(adapter.builderQueue()).resolves.toEqual([
      { id: "www-3agy.4", title: "Define adapter", status: "open", labels: ["ticket-ready"] },
    ]);
    await adapter.writeMetadata("www-3agy.4", metadata);
    await adapter.writeBuilderSummary("www-3agy.4", "Built adapter");
    await adapter.writeReviewerFindings("www-3agy.4", "No findings");
    await adapter.requeueFailedReview("www-3agy.4");
    await adapter.writeEscalation("www-3agy.4", "Human input needed");

    expect(commands).toEqual([
      buildQueueCommand("builder"),
      buildMetadataCommand("www-3agy.4", metadata),
      buildCommentCommand("www-3agy.4", "builder-summary", "Built adapter"),
      buildCommentCommand("www-3agy.4", "reviewer-findings", "No findings"),
      buildFailedReviewRequeueCommand("www-3agy.4"),
      buildCommentCommand("www-3agy.4", "escalation", "Human input needed"),
    ]);
  });

  it("reads full ticket details for workflow runner input", async () => {
    const commands: BeadsCommand[] = [];
    const adapter = new BeadsAdapter(async (command) => {
      commands.push(command);
      return JSON.stringify([
        {
          id: "www-3agy.19",
          title: "Start ticket workflow worktrees from latest origin main",
          status: "open",
          labels: ["ticket-ready"],
          acceptance_criteria: "- [ ] worktree uses origin/main",
          comments: [{ body: "## Context\n\nUse latest main." }],
        },
      ]);
    });

    await expect(adapter.showTickets(["www-3agy.19"])).resolves.toEqual([
      {
        id: "www-3agy.19",
        title: "Start ticket workflow worktrees from latest origin main",
        status: "open",
        labels: ["ticket-ready"],
        acceptanceCriteria: "- [ ] worktree uses origin/main",
        comments: [{ text: "## Context\n\nUse latest main." }],
      },
    ]);
    expect(commands).toEqual([buildShowTicketsCommand(["www-3agy.19"])]);
  });
});

describe("downstream dependency blocked probe", () => {
  it("documents the probe for a downstream ticket blocked by an unclosed ticket-human dependency", () => {
    expect(buildDownstreamBlockedProbeCommand("www-downstream")).toEqual({
      command: "bd",
      args: ["list", "--ready", "--json", "--no-pager", "-n", "0", "--id", "www-downstream"],
    });
    expect(isDownstreamBlockedProbeResult("[]")).toBe(true);
  });

  it("treats a downstream ticket returned by bd ready as unblocked", () => {
    const readyStdout = JSON.stringify([
      { id: "www-downstream", title: "Next ticket", status: "open", labels: ["ticket-ready"] },
    ]);

    expect(isDownstreamBlockedProbeResult(readyStdout)).toBe(false);
  });
});
