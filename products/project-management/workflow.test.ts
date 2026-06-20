import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  workflowColumnsForIssues,
  workflowDashboardColumnsForFilter,
  workflowDashboardForIssues,
} from "./workflow";

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

  it("renders workflow card metadata without tmux commands", async () => {
    const html = await readFile(new URL("./public/Beads.dc.html", import.meta.url), "utf8");
    const boardStart = html.indexOf("<!-- ---------- BOARD (hero) ---------- -->");
    const boardEnd = html.indexOf("<!-- ===================== SETTINGS ===================== -->");
    const board = html.slice(boardStart, boardEnd);

    expect(board).toContain("{{ card.updatedRelative }}");
    expect(board).toContain('title="{{ card.updatedTitle }}"');
    expect(board).toContain("{{ card.hasAttempts }}");
    expect(html).toContain("wf.attempts > 1");
    expect(board).not.toContain("{{ card.tmuxAttachCommand }}");
  });

  it("renders detail copy targets as dark-ui copy surfaces", async () => {
    const html = await readFile(new URL("./public/Beads.dc.html", import.meta.url), "utf8");
    const drawerStart = html.indexOf(
      "<!-- ===================== DETAIL DRAWER ===================== -->",
    );
    const drawerEnd = html.indexOf(
      "<!-- ===================== NEW ISSUE MODAL ===================== -->",
    );
    const drawer = html.slice(drawerStart, drawerEnd);

    expect(drawer).toContain("bd-copy-id");
    expect(drawer).toContain("{{ selected.copyTicketId }}");
    expect(drawer).toContain("{{ selected.idCopied }}");
    expect(drawer).toContain("bd-terminal-copy");
    expect(drawer).toContain("{{ selected.copyTmux }}");
    expect(drawer).toContain("{{ selected.tmuxCopyLabel }}");
    expect(drawer).not.toContain("Copy tmux</button>");
  });

  it("defines copied and failed copy states without throwing", async () => {
    const html = await readFile(new URL("./public/Beads.dc.html", import.meta.url), "utf8");

    expect(html).toContain("copiedTarget: null");
    expect(html).toContain("workflowControlStatus: 'Copied'");
    expect(html).toContain("workflowControlStatus: 'Copy failed'");
    expect(html).toContain("try {");
    expect(html).toContain("} catch (err) {");
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
        metadata: { ticket_phase: "review" },
      }),
      workflowIssue("www-retry", "ready", ["ticket-ready", "ticket-retry"], {
        assignee: "",
        title: "Retry ticket",
      }),
      workflowIssue("www-human", "blocked", ["ticket-ready", "ticket-human"], {
        title: "Human ticket",
        metadata: { ticket_phase: "human" },
      }),
      workflowIssue("www-shipped", "closed", ["ticket-verified"], {
        title: "Shipped ticket",
        metadata: { ticket_phase: "shipped", ticket_last_result: "shipped" },
      }),
    ]);

    expect(
      dashboard.columns.map((column) => [column.id, column.tickets.map((ticket) => ticket.id)]),
    ).toEqual([
      ["backlog", []],
      ["queued", []],
      ["ready", ["www-build", "www-retry"]],
      ["review", ["www-review"]],
      ["verified", ["www-verified"]],
      ["human", ["www-human"]],
      ["shipped", ["www-shipped"]],
    ]);
    expect(dashboard.activeRuns.map((ticket) => [ticket.id, ticket.activeRun])).toEqual([
      ["www-build", "builder"],
      ["www-review", "reviewer"],
      ["www-retry", "builder"],
    ]);
    expect(dashboard.columns[2].tickets[0]).toEqual(
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
    expect(dashboard.columns[4].tickets[0]).toEqual(
      expect.objectContaining({ id: "www-verified", phase: "review", activeRun: null }),
    );
    expect(dashboard.columns[3].tickets[0]).toEqual(
      expect.objectContaining({
        logLinks: ["/cache/logs/ticket_www-review_review_1.stderr.log"],
        promptLinks: ["/cache/logs/ticket_www-review_review_1.prompt.md"],
      }),
    );
  });

  it("orders workflow lanes and classifies backlog, queued, retry, and shipped tickets without duplicates", () => {
    const dashboard = workflowDashboardForIssues([
      workflowIssue("www-backlog-label", "ready", ["ticket-backlog"]),
      workflowIssue("www-backlog-phase", "ready", ["ticket-ready"], {
        metadata: { ticket_phase: "backlog" },
      }),
      workflowIssue("www-backlog-blocked", "blocked", ["ticket-backlog", "ticket-ready"]),
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
      ["backlog", "Backlog"],
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
      ["backlog", ["www-backlog-label", "www-backlog-phase", "www-backlog-blocked"]],
      ["queued", ["www-queued-blocked", "www-queued-not-ready"]],
      ["ready", ["www-retry"]],
      ["review", ["www-review"]],
      ["verified", ["www-verified"]],
      ["human", ["www-human"]],
      ["shipped", ["www-shipped"]],
    ]);
    expect(dashboard.columns[2].tickets[0]).toEqual(
      expect.objectContaining({ id: "www-retry", phase: "build", attempts: 3 }),
    );
    expect(
      new Set(dashboard.columns.flatMap((column) => column.tickets.map((ticket) => ticket.id))),
    ).toEqual(
      new Set([
        "www-backlog-label",
        "www-backlog-phase",
        "www-backlog-blocked",
        "www-queued-blocked",
        "www-queued-not-ready",
        "www-retry",
        "www-review",
        "www-verified",
        "www-human",
        "www-shipped",
      ]),
    );
    expect(dashboard.columns.flatMap((column) => column.tickets)).toHaveLength(10);
  });

  it("routes unclaimed ticket-ready issues to queued until builder metadata exists", () => {
    const dashboard = workflowDashboardForIssues([
      workflowIssue("www-unclaimed", "ready", ["ticket-ready"]),
      workflowIssue("www-phase-build", "ready", ["ticket-ready"], {
        metadata: { ticket_phase: "build" },
      }),
      workflowIssue("www-tmux-build", "ready", ["ticket-ready"], {
        metadata: { ticket_tmux_session: "ticket_www-tmux-build_1" },
      }),
      workflowIssue("www-session-build", "ready", ["ticket-ready"], {
        metadata: { ticket_opencode_session: "Builder run (ses_builder)" },
      }),
    ]);

    expect(
      dashboard.columns.map((column) => [column.id, column.tickets.map((ticket) => ticket.id)]),
    ).toEqual([
      ["backlog", []],
      ["queued", ["www-unclaimed"]],
      ["ready", ["www-phase-build", "www-tmux-build", "www-session-build"]],
      ["review", []],
      ["verified", []],
      ["human", []],
      ["shipped", []],
    ]);
  });

  it("filters workflow columns with all-only, multi-select, deselect, and stable ordering", () => {
    const dashboard = workflowDashboardForIssues([
      workflowIssue("www-backlog", "ready", ["ticket-backlog"]),
      workflowIssue("www-build", "ready", ["ticket-ready"]),
      workflowIssue("www-review", "ready", ["ticket-review"]),
      workflowIssue("www-human", "ready", ["ticket-human"]),
    ]);

    expect(workflowDashboardColumnsForFilter(dashboard, "all").map((column) => column.id)).toEqual([
      "backlog",
      "queued",
      "ready",
      "review",
      "verified",
      "human",
      "shipped",
    ]);
    expect(
      workflowDashboardColumnsForFilter(dashboard, ["human", "ready", "backlog"]).map(
        (column) => column.id,
      ),
    ).toEqual(["backlog", "ready", "human"]);
    expect(
      workflowDashboardColumnsForFilter(dashboard, ["human", "backlog"]).map((c) => c.id),
    ).toEqual(["backlog", "human"]);
    expect(workflowDashboardColumnsForFilter(dashboard, []).map((column) => column.id)).toEqual(
      dashboard.columns.map((column) => column.id),
    );
  });

  it("does not show builder or reviewer active runs outside active build and review queues", () => {
    const dashboard = workflowDashboardForIssues([
      workflowIssue("www-queued-build", "blocked", ["ticket-ready"], {
        metadata: { ticket_phase: "build" },
      }),
      workflowIssue("www-human-review", "blocked", ["ticket-human"], {
        metadata: { ticket_phase: "review" },
      }),
      workflowIssue("www-shipped-review", "closed", ["ticket-verified"], {
        metadata: { ticket_phase: "shipped", ticket_last_result: "shipped" },
      }),
      workflowIssue("www-ready-build", "ready", ["ticket-ready"], {
        metadata: { ticket_phase: "build" },
      }),
      workflowIssue("www-review-active", "ready", ["ticket-review"], {
        metadata: { ticket_phase: "review" },
      }),
    ]);

    expect(dashboard.activeRuns.map((ticket) => [ticket.id, ticket.activeRun])).toEqual([
      ["www-ready-build", "builder"],
      ["www-review-active", "reviewer"],
    ]);
    expect(
      dashboard.columns.flatMap((column) =>
        column.tickets
          .filter((ticket) => ticket.id !== "www-ready-build" && ticket.id !== "www-review-active")
          .map((ticket) => [ticket.id, ticket.activeRun]),
      ),
    ).toEqual([
      ["www-queued-build", null],
      ["www-human-review", null],
      ["www-shipped-review", null],
    ]);
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
