import { describe, expect, it } from "vitest";
import { runTicketQueueBatch, type TicketQueueWorkflowChildInput } from "./workflows";

describe("runTicketQueueBatch", () => {
  it("starts one child ticket workflow per queued ticket", async () => {
    const children: TicketQueueWorkflowChildInput[] = [];
    const result = await runTicketQueueBatch(
      {
        repoRoot: "/repo",
        finalGates: [{ label: "test", command: "bun", args: ["run", "test"] }],
        runtimeLogRoot: "/logs",
        baseRef: "origin/main",
        requirePushedBranch: true,
        mergeStrategy: "merge",
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
        input: {
          ticketId: "www-3agy.19",
          runner: {
            title: "Start ticket workflow worktrees from latest origin main",
            repoRoot: "/repo",
            acceptanceCriteria: "- [ ] worktree starts from latest main",
            comments: ["## Context\n\nUse latest main."],
            finalGates: [{ label: "test", command: "bun", args: ["run", "test"] }],
            runtimeLogRoot: "/logs",
            baseRef: "origin/main",
            requirePushedBranch: true,
            mergeStrategy: "merge",
          },
        },
      },
      {
        ticketId: "www-3agy.20",
        input: {
          ticketId: "www-3agy.20",
          runner: {
            title: "Add manual cleanup for completed ticket workflow artifacts",
            repoRoot: "/repo",
            acceptanceCriteria: "- [ ] cleanup is safe",
            comments: [],
            finalGates: [{ label: "test", command: "bun", args: ["run", "test"] }],
            runtimeLogRoot: "/logs",
            baseRef: "origin/main",
            requirePushedBranch: true,
            mergeStrategy: "merge",
          },
        },
      },
    ]);
  });

  it("reports duplicate child workflows as skipped without blocking the batch", async () => {
    const result = await runTicketQueueBatch(
      {
        repoRoot: "/repo",
        finalGates: [],
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

    const oldQueueResult = await runTicketQueueBatch(
      { repoRoot: "/repo", finalGates: [] },
      tickets,
      startOnce,
    );
    const newQueueResult = await runTicketQueueBatch(
      { repoRoot: "/repo", finalGates: [] },
      tickets,
      startOnce,
    );

    expect(oldQueueResult).toEqual({ started: ["www-overlap"], skipped: [] });
    expect(newQueueResult).toEqual({ started: [], skipped: ["www-overlap"] });
    expect([...started]).toEqual(["www-overlap"]);
  });
});
