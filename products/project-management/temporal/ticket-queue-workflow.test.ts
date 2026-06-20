import { describe, expect, it } from "vitest";
import type { TicketWorkflowRuntimeConfig } from "./command-activities";
import { runTicketQueueBatch, type TicketQueueWorkflowChildInput } from "./workflows";

describe("runTicketQueueBatch", () => {
  it("starts one child ticket workflow per queued ticket", async () => {
    const children: TicketQueueWorkflowChildInput[] = [];
    const result = await runTicketQueueBatch(
      {
        ...baseConfig(),
        baseRef: "origin/main",
      },
      [
        {
          ticketId: "www-3agy.19",
          title: "Start ticket workflow worktrees from latest origin main",
          acceptanceCriteria: "- [ ] worktree starts from latest main",
          comments: ["## Context\n\nUse latest main."],
        },
        {
          ticketId: "www-3agy.20",
          title: "Add manual cleanup for completed ticket workflow artifacts",
          acceptanceCriteria: "- [ ] cleanup is safe",
          comments: [],
        },
      ],
      async (child) => {
        children.push(child);
        return "started";
      },
    );

    expect(result).toEqual({ started: ["www-3agy.19", "www-3agy.20"], skipped: [] });
    expect(children).toEqual([
      {
        ticketId: "www-3agy.19",
      },
      {
        ticketId: "www-3agy.20",
      },
    ]);
  });

  it("reports duplicate child workflows as skipped without blocking the batch", async () => {
    const result = await runTicketQueueBatch(
      {
        ...baseConfig(),
        maxTicketsPerPoll: 2,
      },
      [
        { ticketId: "www-start", title: "Start", acceptanceCriteria: "- [ ] start", comments: [] },
        { ticketId: "www-skip", title: "Skip", acceptanceCriteria: "- [ ] skip", comments: [] },
        { ticketId: "www-later", title: "Later", acceptanceCriteria: "- [ ] later", comments: [] },
      ],
      async (child) => (child.ticketId === "www-skip" ? "skipped" : "started"),
    );

    expect(result).toEqual({ started: ["www-start"], skipped: ["www-skip"] });
  });

  it("does not start more tickets than active workflow slots", async () => {
    const children: TicketQueueWorkflowChildInput[] = [];
    const result = await runTicketQueueBatch(
      {
        ...baseConfig(),
        maxActiveTicketWorkflows: 3,
        maxTicketsPerPoll: 3,
      },
      [
        {
          ticketId: "www-running-a",
          title: "Running A",
          acceptanceCriteria: "- [ ] a",
          comments: [],
        },
        {
          ticketId: "www-running-b",
          title: "Running B",
          acceptanceCriteria: "- [ ] b",
          comments: [],
        },
        { ticketId: "www-later", title: "Later", acceptanceCriteria: "- [ ] later", comments: [] },
      ],
      async (child) => {
        children.push(child);
        return "started";
      },
      2,
    );

    expect(result).toEqual({ started: ["www-running-a"], skipped: [] });
    expect(children.map((child) => child.ticketId)).toEqual(["www-running-a"]);
  });

  it("does not start duplicate child workflows when old and new queues overlap", async () => {
    const started = new Set<string>();
    const tickets = [
      {
        ticketId: "www-overlap",
        title: "Overlap",
        acceptanceCriteria: "- [ ] overlap",
        comments: [],
      },
    ];
    const startOnce = async (child: TicketQueueWorkflowChildInput) => {
      if (started.has(child.ticketId)) return "skipped" as const;
      started.add(child.ticketId);
      return "started" as const;
    };

    const oldQueueResult = await runTicketQueueBatch(baseConfig(), tickets, startOnce);
    const newQueueResult = await runTicketQueueBatch(baseConfig(), tickets, startOnce);

    expect(oldQueueResult).toEqual({ started: ["www-overlap"], skipped: [] });
    expect(newQueueResult).toEqual({ started: [], skipped: ["www-overlap"] });
    expect([...started]).toEqual(["www-overlap"]);
  });
});

function baseConfig(
  overrides: Partial<TicketWorkflowRuntimeConfig> = {},
): TicketWorkflowRuntimeConfig {
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
    ...overrides,
  };
}
