import { describe, expect, it } from "vitest";
import {
  ACTIVE_TICKET_LIFECYCLE_LABELS,
  assertNoConflictingTicketLifecycleLabels,
  BeadsAdapter,
  type BeadsCommand,
  BUILDER_QUEUE_EXCLUDED_LABELS,
  buildCommentCommand,
  buildDownstreamBlockedProbeCommand,
  buildFailedReviewRequeueCommand,
  buildMetadataCommand,
  buildQueueCommand,
  buildRetryQueueCommand,
  buildShowTicketsCommand,
  buildVerifiedQueueCommand,
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
      backlog: "ticket-backlog",
      queued: "ticket-queued",
      ready: "ticket-ready",
      review: "ticket-review",
      verified: "ticket-verified",
      retry: "ticket-retry",
      human: "ticket-human",
      shipped: "ticket-shipped",
    });
    expect(ACTIVE_TICKET_LIFECYCLE_LABELS).toEqual([
      "ticket-ready",
      "ticket-review",
      "ticket-verified",
      "ticket-retry",
      "ticket-human",
      "ticket-shipped",
    ]);
    expect(TICKET_QUEUE_LABELS).toEqual({
      builder: "ticket-ready",
      review: "ticket-review",
      verified: "ticket-verified",
      human: "ticket-human",
    });
    expect(BUILDER_QUEUE_EXCLUDED_LABELS).toEqual(["ticket-human", "ticket-backlog", "manual"]);
  });
});

describe("buildQueueCommand", () => {
  it("exposes the builder queue from ticket-ready without treating human or backlog tickets as ready work", () => {
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
        "--exclude-label",
        "ticket-backlog",
        "--exclude-label",
        "manual",
      ],
    });
  });

  it("exposes review, verified, and human queues from their labels", () => {
    expect(buildQueueCommand("review").args).toContain("ticket-review");
    expect(buildQueueCommand("verified").args).toContain("ticket-verified");
    expect(buildQueueCommand("human").args).toContain("ticket-human");
    expect(buildQueueCommand("human").args).not.toContain("--ready");
  });

  it("exposes claimed verified tickets for merge queue automation", () => {
    expect(buildVerifiedQueueCommand("open").args).toEqual([
      "list",
      "--json",
      "--no-pager",
      "-n",
      "0",
      "--status",
      "open",
      "--label",
      "ticket-verified",
    ]);
    expect(buildVerifiedQueueCommand("in_progress").args).toContain("in_progress");
  });

  it("exposes retry tickets as builder work without needing ticket-ready", () => {
    expect(buildRetryQueueCommand()).toEqual({
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
        "ticket-retry",
        "--ready",
        "--exclude-label",
        "ticket-human",
        "--exclude-label",
        "ticket-backlog",
      ],
    });
  });
});

describe("ticket lifecycle label invariant", () => {
  it("rejects multiple active lifecycle labels", () => {
    expect(() =>
      assertNoConflictingTicketLifecycleLabels(["ticket-review", "ticket-human"]),
    ).toThrow("Conflicting ticket lifecycle labels: ticket-review, ticket-human");
  });

  it("allows non-lifecycle labels and one active lifecycle label", () => {
    expect(() =>
      assertNoConflictingTicketLifecycleLabels(["project-management", "ticket-retry"]),
    ).not.toThrow();
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

  it("builds a failed-review requeue command with only the retry lifecycle label", () => {
    expect(buildFailedReviewRequeueCommand("www-3agy.10")).toEqual({
      command: "bd",
      args: [
        "update",
        "www-3agy.10",
        "--add-label",
        "ticket-retry",
        "--remove-label",
        "ticket-ready",
        "--remove-label",
        "ticket-review",
        "--remove-label",
        "ticket-verified",
        "--remove-label",
        "ticket-human",
        "--remove-label",
        "ticket-shipped",
      ],
    });
  });
});

describe("BeadsAdapter", () => {
  it("selects only normal ticket-ready issues for the auto-builder queue", async () => {
    const adapter = new BeadsAdapter(async () =>
      JSON.stringify([
        {
          id: "www-manual",
          title: "Manual ticket",
          status: "open",
          labels: ["ticket-ready", "manual"],
        },
        {
          id: "www-human",
          title: "Human ticket",
          status: "open",
          labels: ["ticket-ready", "ticket-human"],
        },
        {
          id: "www-normal",
          title: "Normal ticket",
          status: "open",
          labels: ["ticket-ready"],
        },
      ]),
    );

    await expect(adapter.builderQueue()).resolves.toEqual([
      {
        id: "www-normal",
        title: "Normal ticket",
        status: "open",
        labels: ["ticket-ready"],
      },
    ]);
  });

  it("runs queue, metadata, and comment commands through the injected boundary", async () => {
    const commands: BeadsCommand[] = [];
    const adapter = new BeadsAdapter(async (command) => {
      commands.push(command);
      const labels = command.args.includes("ticket-retry") ? ["ticket-retry"] : ["ticket-ready"];
      return JSON.stringify([
        { id: "www-3agy.4", title: "Define adapter", status: "open", labels },
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
      buildRetryQueueCommand(),
      buildMetadataCommand("www-3agy.4", metadata),
      buildCommentCommand("www-3agy.4", "builder-summary", "Built adapter"),
      buildCommentCommand("www-3agy.4", "reviewer-findings", "No findings"),
      buildFailedReviewRequeueCommand("www-3agy.4"),
      buildCommentCommand("www-3agy.4", "escalation", "Human input needed"),
    ]);
  });

  it("includes open and in-progress verified tickets in merge queue order", async () => {
    const commands: BeadsCommand[] = [];
    const adapter = new BeadsAdapter(async (command) => {
      commands.push(command);
      if (command.args.includes("open")) {
        return JSON.stringify([
          { id: "www-open", title: "Open verified", status: "open", labels: ["ticket-verified"] },
        ]);
      }
      return JSON.stringify([
        {
          id: "www-claimed",
          title: "Claimed verified",
          status: "in_progress",
          labels: ["ticket-verified"],
        },
      ]);
    });

    await expect(adapter.verifiedQueue()).resolves.toEqual([
      { id: "www-open", title: "Open verified", status: "open", labels: ["ticket-verified"] },
      {
        id: "www-claimed",
        title: "Claimed verified",
        status: "in_progress",
        labels: ["ticket-verified"],
      },
    ]);
    expect(commands).toEqual([
      buildVerifiedQueueCommand("open"),
      buildVerifiedQueueCommand("in_progress"),
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
