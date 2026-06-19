import { readFile } from "node:fs/promises";
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

describe("Beads detail template", () => {
  it("renders comments after dependencies and activity in the detail drawer", async () => {
    const html = await readFile(new URL("./public/Beads.dc.html", import.meta.url), "utf8");
    const drawerStart = html.indexOf(
      "<!-- ===================== DETAIL DRAWER ===================== -->",
    );
    const drawerEnd = html.indexOf(
      "<!-- ===================== NEW ISSUE MODAL ===================== -->",
    );
    const drawer = html.slice(drawerStart, drawerEnd);

    expect(drawer.indexOf('<span class="cap">Dependencies</span>')).toBeGreaterThan(0);
    expect(drawer.indexOf('<span class="cap">Activity</span>')).toBeGreaterThan(
      drawer.indexOf('<span class="cap">Dependencies</span>'),
    );
    expect(drawer.indexOf('<span class="cap">Comments</span>')).toBeGreaterThan(
      drawer.indexOf('<span class="cap">Activity</span>'),
    );
  });
});

describe("workflowDashboardForIssues", () => {
  it("maps ticket workflow labels and metadata into dashboard columns", () => {
    const dashboard = workflowDashboardForIssues([
      workflowIssue("www-build", "in_progress", ["ticket-ready"], {
        assignee: "claude",
        title: "Build ticket",
        metadata: {
          ticket_phase: "build",
          ticket_attempts: "2",
          ticket_tmux_session: "ticket_www-build_builder",
          ticket_opencode_session: "Builder run (ses_builder)",
          ticket_log_path: "/cache/logs/ticket_www-build_builder.stdout.log",
          ticket_prompt_path: "/cache/logs/ticket_www-build_builder.prompt.md",
          ticket_last_result: "builder-timeout",
        },
      }),
      workflowIssue("www-review", "ready", ["ticket-review"], {
        assignee: "reviewer",
        title: "Review ticket",
        metadata: { ticket_phase: "review", ticket_opencode_session_title: "Review session" },
        comments: [
          {
            id: "comment_1",
            author: "reviewer",
            text: "prompt /cache/logs/ticket_www-review_review_1.prompt.md\nlog /cache/logs/ticket_www-review_review_1.stderr.log",
            created: Date.parse("2026-06-02T12:00:00Z"),
          },
        ],
      }),
      workflowIssue("www-verified", "ready", ["ticket-verified"], {
        assignee: "",
        title: "Verified ticket",
      }),
      workflowIssue("www-retry", "ready", ["ticket-ready", "ticket-retry"], {
        assignee: "",
        title: "Retry ticket",
      }),
      workflowIssue("www-human", "blocked", ["ticket-ready", "ticket-human"], {
        title: "Human ticket",
        metadata: { ticket_phase: "human" },
      }),
    ]);

    expect(
      dashboard.columns.map((column) => [column.id, column.tickets.map((ticket) => ticket.id)]),
    ).toEqual([
      ["queued", []],
      ["ready", ["www-build", "www-retry"]],
      ["review", ["www-review"]],
      ["verified", ["www-verified"]],
      ["human", ["www-human"]],
      ["shipped", []],
    ]);
    expect(dashboard.activeRuns.map((ticket) => [ticket.id, ticket.activeRun])).toEqual([
      ["www-build", "builder"],
      ["www-review", "reviewer"],
      ["www-retry", "builder"],
    ]);
    expect(dashboard.columns[1].tickets[0]).toEqual(
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
    expect(dashboard.columns[2].tickets[0]).toEqual(
      expect.objectContaining({
        logLinks: ["/cache/logs/ticket_www-review_review_1.stderr.log"],
        promptLinks: ["/cache/logs/ticket_www-review_review_1.prompt.md"],
      }),
    );
  });

  it("orders workflow lanes and classifies queued, retry, and shipped tickets without duplicates", () => {
    const dashboard = workflowDashboardForIssues([
      workflowIssue("www-queued-blocked", "blocked", ["ticket-ready"]),
      workflowIssue("www-queued-not-ready", "ready", ["ticket-ready"], {
        blockedBy: ["www-parent"],
      }),
      workflowIssue("www-retry", "ready", ["ticket-ready", "ticket-retry"], {
        metadata: { ticket_attempts: "3", ticket_last_result: "reviewer-failed" },
      }),
      workflowIssue("www-review", "ready", ["ticket-review"]),
      workflowIssue("www-verified", "ready", ["ticket-verified"]),
      workflowIssue("www-human", "blocked", ["ticket-human"]),
      workflowIssue("www-shipped", "closed", ["ticket-verified"], {
        metadata: { ticket_phase: "closed", ticket_last_result: "merge-passed" },
      }),
      workflowIssue("www-closed-manual", "closed", ["ticket-ready"]),
    ]);

    expect(dashboard.columns.map((column) => [column.id, column.title])).toEqual([
      ["queued", "Queued"],
      ["ready", "Builder"],
      ["review", "Review"],
      ["verified", "Verified"],
      ["human", "Human"],
      ["shipped", "Shipped"],
    ]);
    expect(
      dashboard.columns.map((column) => [column.id, column.tickets.map((ticket) => ticket.id)]),
    ).toEqual([
      ["queued", ["www-queued-blocked", "www-queued-not-ready"]],
      ["ready", ["www-retry"]],
      ["review", ["www-review"]],
      ["verified", ["www-verified"]],
      ["human", ["www-human"]],
      ["shipped", ["www-shipped"]],
    ]);
    expect(dashboard.columns[1].tickets[0]).toEqual(
      expect.objectContaining({ id: "www-retry", phase: "build", attempts: 3 }),
    );
    expect(
      new Set(dashboard.columns.flatMap((column) => column.tickets.map((ticket) => ticket.id))),
    ).toEqual(
      new Set([
        "www-queued-blocked",
        "www-queued-not-ready",
        "www-retry",
        "www-review",
        "www-verified",
        "www-human",
        "www-shipped",
      ]),
    );
  });
});

type WorkflowIssueInput = Parameters<typeof workflowDashboardForIssues>[0][number];

function workflowIssue(
  id: string,
  status: WorkflowIssueInput["status"],
  labels: string[],
  overrides: Partial<WorkflowIssueInput> = {},
): WorkflowIssueInput {
  return {
    id,
    title: id,
    status,
    assignee: "Calum",
    labels,
    blockedBy: [],
    ...overrides,
  };
}
