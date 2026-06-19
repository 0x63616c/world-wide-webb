import { describe, expect, it } from "vitest";
import { workflowColumnsForIssues, workflowDashboardForIssues } from "./workflow";

describe("workflowColumnsForIssues", () => {
  it("groups issues into workflow columns without losing issue order", () => {
    const columns = workflowColumnsForIssues([
      { id: "www-a", status: "ready" },
      { id: "www-b", status: "blocked" },
      { id: "www-c", status: "ready" },
      { id: "www-d", status: "closed" },
      { id: "www-e", status: "in_progress" },
    ]);

    expect(columns).toEqual([
      { id: "ready", title: "Ready", issueIds: ["www-a", "www-c"] },
      { id: "in_progress", title: "In Progress", issueIds: ["www-e"] },
      { id: "blocked", title: "Blocked", issueIds: ["www-b"] },
      { id: "closed", title: "Closed", issueIds: ["www-d"] },
    ]);
  });
});

describe("workflowDashboardForIssues", () => {
  it("maps ticket workflow labels and metadata into dashboard columns", () => {
    const dashboard = workflowDashboardForIssues([
      {
        id: "www-build",
        title: "Build ticket",
        status: "in_progress",
        assignee: "claude",
        labels: ["ticket-ready"],
        metadata: {
          ticket_phase: "build",
          ticket_attempts: "2",
          ticket_tmux_session: "ticket_www-build_builder",
          ticket_opencode_session: "Builder run (ses_builder)",
          ticket_log_path: "/cache/logs/ticket_www-build_builder.stdout.log",
          ticket_prompt_path: "/cache/logs/ticket_www-build_builder.prompt.md",
          ticket_last_result: "builder-timeout",
        },
      },
      {
        id: "www-review",
        title: "Review ticket",
        status: "ready",
        assignee: "reviewer",
        labels: ["ticket-review"],
        metadata: { ticket_phase: "review", ticket_opencode_session_title: "Review session" },
        comments: [
          {
            id: "comment_1",
            author: "reviewer",
            text: "prompt /cache/logs/ticket_www-review_review_1.prompt.md\nlog /cache/logs/ticket_www-review_review_1.stderr.log",
            created: Date.parse("2026-06-02T12:00:00Z"),
          },
        ],
      },
      {
        id: "www-verified",
        title: "Verified ticket",
        status: "ready",
        assignee: "",
        labels: ["ticket-verified"],
        metadata: {},
      },
      {
        id: "www-retry",
        title: "Retry ticket",
        status: "ready",
        assignee: "",
        labels: ["ticket-ready", "ticket-retry"],
        metadata: {},
      },
      {
        id: "www-human",
        title: "Human ticket",
        status: "blocked",
        assignee: "Calum",
        labels: ["ticket-ready", "ticket-human"],
        metadata: { ticket_phase: "human" },
      },
      {
        id: "www-shipped",
        title: "Shipped ticket",
        status: "closed",
        assignee: "",
        labels: [
          "ticket-ready",
          "ticket-review",
          "ticket-verified",
          "ticket-retry",
          "ticket-human",
        ],
        metadata: { ticket_phase: "shipped", ticket_last_result: "shipped" },
      },
    ]);

    expect(
      dashboard.columns.map((column) => [column.id, column.tickets.map((ticket) => ticket.id)]),
    ).toEqual([
      ["ready", ["www-build"]],
      ["review", ["www-review"]],
      ["verified", ["www-verified"]],
      ["retry", ["www-retry"]],
      ["human", ["www-human"]],
    ]);
    expect(dashboard.activeRuns.map((ticket) => [ticket.id, ticket.activeRun])).toEqual([
      ["www-build", "builder"],
      ["www-review", "reviewer"],
    ]);
    expect(
      dashboard.columns.flatMap((column) => column.tickets.map((ticket) => ticket.id)),
    ).not.toContain("www-shipped");
    expect(dashboard.columns[0].tickets[0]).toEqual(
      expect.objectContaining({
        phase: "build",
        attempts: 2,
        tmuxAttachCommand: "tmux attach -t ticket_www-build_builder",
        openCodeSessionId: "ses_builder",
        openCodeSessionTitle: "Builder run",
        logLinks: ["/cache/logs/ticket_www-build_builder.stdout.log"],
        promptLinks: ["/cache/logs/ticket_www-build_builder.prompt.md"],
        lastResult: "builder-timeout",
      }),
    );
    expect(dashboard.columns[1].tickets[0]).toEqual(
      expect.objectContaining({
        logLinks: ["/cache/logs/ticket_www-review_review_1.stderr.log"],
        promptLinks: ["/cache/logs/ticket_www-review_review_1.prompt.md"],
      }),
    );
  });
});
