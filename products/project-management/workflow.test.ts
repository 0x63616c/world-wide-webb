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
  it("sets the document title in the prototype HTML", async () => {
    const html = await readFile(new URL("./public/Beads.dc.html", import.meta.url), "utf8");

    expect(html).toContain("<title>Project Management UI</title>");
  });

  it("exposes created and updated timestamps in the sortable issues table", async () => {
    const html = await readFile(new URL("./public/Beads.dc.html", import.meta.url), "utf8");
    const issuesStart = html.indexOf("<!-- ---------- ISSUES ---------- -->");
    const issuesEnd = html.indexOf("<!-- ---------- EPICS ---------- -->");
    const issues = html.slice(issuesStart, issuesEnd);

    expect(issues).toContain("{{ row.createdLabel }}");
    expect(issues).toContain("{{ row.updatedLabel }}");
    expect(issues).toContain('title="{{ row.createdTitle }}"');
    expect(issues).toContain('title="{{ row.updatedTitle }}"');
    expect(html).toContain("{ key: 'created', label: 'Created' }");
    expect(html).toContain("{ key: 'updated', label: 'Updated' }");
    expect(html).toContain("case 'created': return it.created || 0;");
    expect(html).toContain("case 'updated': return it.updated || 0;");
  });

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

  it("does not render close command preview fields in the detail drawer", async () => {
    const html = await readFile(new URL("./public/Beads.dc.html", import.meta.url), "utf8");
    const drawerStart = html.indexOf(
      "<!-- ===================== DETAIL DRAWER ===================== -->",
    );
    const drawerEnd = html.indexOf(
      "<!-- ===================== NEW ISSUE MODAL ===================== -->",
    );
    const drawer = html.slice(drawerStart, drawerEnd);

    expect(drawer).not.toContain("Close command preview");
    expect(drawer).not.toContain("{{ selected.closeReason }}");
    expect(drawer).not.toContain("{{ selected.onCloseReasonInput }}");
    expect(drawer).not.toContain("{{ selected.closeCommand }}");
    expect(drawer).not.toContain("{{ selected.copyCloseCommand }}");
    expect(html).not.toContain("defaultCloseReason(issue)");
    expect(html).not.toContain("this.shellQuote(issue.id)");
  });

  it("does not expose a close-command copy action", async () => {
    const html = await readFile(new URL("./public/Beads.dc.html", import.meta.url), "utf8");

    expect(html).not.toContain(
      "copyCloseCommand: () => this.copyText(closeCommand, 'close-command')",
    );
    expect(html).not.toContain("closeCommandCopyLabel");
    expect(html).toContain("copiedTarget: null");
    expect(html).not.toContain("workflowAction");
    expect(html).not.toContain("/api/workflow-control");
  });

  it("defines copied and failed copy states without throwing", async () => {
    const html = await readFile(new URL("./public/Beads.dc.html", import.meta.url), "utf8");

    expect(html).toContain("copiedTarget: null");
    expect(html).toContain("copyStatus: 'Copied'");
    expect(html).toContain("copyStatus: 'Copy failed'");
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
      workflowIssue("www-retry", "ready", ["ticket-retry"], {
        assignee: "",
        title: "Retry ticket",
      }),
      workflowIssue("www-human", "blocked", ["ticket-human"], {
        title: "Human ticket",
        metadata: { ticket_phase: "human" },
      }),
      workflowIssue("www-shipped", "closed", [], {
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
      workflowIssue("www-retry", "ready", ["ticket-retry"], {
        metadata: { ticket_attempts: "3", ticket_last_result: "reviewer-failed" },
      }),
      workflowIssue("www-review", "ready", ["ticket-review"]),
      workflowIssue("www-verified", "ready", ["ticket-verified"]),
      workflowIssue("www-human", "blocked", ["ticket-human"]),
      workflowIssue("www-shipped", "closed", [], {
        metadata: { ticket_phase: "closed", ticket_last_result: "merge-passed" },
      }),
      workflowIssue("www-closed-manual", "closed", ["ticket-ready"]),
    ]);

    expect(dashboard.columns.map((column) => [column.id, column.title])).toEqual([
      ["backlog", "Backlog"],
      ["queued", "Queued"],
      ["ready", "Builder"],
      ["review", "Review"],
      ["verified", "Merge Queue"],
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
      workflowIssue("www-shipped-review", "closed", [], {
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

  it("surfaces builder-exhausted failure details with log excerpt and exit status", () => {
    const dashboard = workflowDashboardForIssues(
      [
        workflowIssue("www-build-fail", "blocked", ["ticket-human"], {
          title: "Build failing ticket",
          metadata: {
            ticket_phase: "build",
            ticket_attempts: "2",
            ticket_stderr_log: "/cache/logs/ticket_www-build-fail_build_2.stderr.log",
            ticket_last_result: "builder-failed",
          },
        }),
      ],
      {
        "/cache/logs/ticket_www-build-fail_build_2.stderr.log":
          "bun run typecheck\nproducts/project-management/workflow.ts:12: failed\nlast useful line",
        "/cache/logs/ticket_www-build-fail_build_2.exitcode": "1",
      },
    );

    expect(dashboard.columns[5].tickets[0].exhaustion).toEqual({
      stopReason: "Stopped: builder attempt limit hit.",
      builderLimitHit: true,
      reviewerLimitHit: false,
      builderFailure: {
        ticketId: "www-build-fail",
        ticketTitle: "Build failing ticket",
        attempt: 2,
        phase: "build",
        commandName: "ticket-builder",
        exitStatus: 1,
        excerpt:
          "bun run typecheck\nproducts/project-management/workflow.ts:12: failed\nlast useful line",
        artifactLink: "/cache/logs/ticket_www-build-fail_build_2.stderr.log",
      },
      reviewerFailure: null,
    });
  });

  it("surfaces reviewer-exhausted failure details with findings, references, and gate", () => {
    const dashboard = workflowDashboardForIssues([
      workflowIssue("www-review-fail", "blocked", ["ticket-human"], {
        title: "Review failing ticket",
        metadata: {
          ticket_phase: "review",
          ticket_attempts: "2",
          ticket_stderr_log: "/cache/logs/ticket_www-review-fail_review_2.stderr.log",
          ticket_last_result: "reviewer-ambiguous",
        },
        comments: [
          {
            id: "comment_1",
            author: "ticket-reviewer",
            text: "## Reviewer findings\n\nBlocking AC failed: screenshot gate missing.\nproducts/project-management/public/Beads.dc.html:421 needs a log link.",
            created: Date.parse("2026-06-20T12:00:00Z"),
          },
        ],
      }),
    ]);

    expect(dashboard.columns[5].tickets[0].exhaustion).toEqual(
      expect.objectContaining({
        stopReason: "Stopped: reviewer attempt limit hit.",
        builderLimitHit: false,
        reviewerLimitHit: true,
        builderFailure: null,
        reviewerFailure: {
          role: "ticket-reviewer",
          findingSummary: "Blocking AC failed: screenshot gate missing.",
          fileLineReferences: ["products/project-management/public/Beads.dc.html:421"],
          blockingCriterionOrGate: "Blocking AC failed: screenshot gate missing.",
          artifactLink: "/cache/logs/ticket_www-review-fail_review_2.stderr.log",
        },
      }),
    );
  });

  it("rejects open workflow tickets with multiple active lifecycle labels", () => {
    expect(() =>
      workflowDashboardForIssues([
        workflowIssue("www-conflict", "ready", ["ticket-review", "ticket-human"]),
      ]),
    ).toThrow("Conflicting ticket lifecycle labels: ticket-review, ticket-human");
  });

  it("allows closed tickets to keep historical lifecycle labels", () => {
    expect(() =>
      workflowDashboardForIssues([
        workflowIssue("www-archived", "closed", ["ticket-retry", "ticket-human"]),
      ]),
    ).not.toThrow();
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
