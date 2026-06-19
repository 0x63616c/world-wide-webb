import { describe, expect, it } from "vitest";
import { planTicketArtifactCleanup } from "./ticket-artifact-cleanup";

describe("planTicketArtifactCleanup", () => {
  it("targets only the requested ticket worktrees and reports tmux sessions without touching unrelated sessions", () => {
    const plan = planTicketArtifactCleanup({
      ticketId: "www-3agy.20",
      repoRoot: "/repo",
      runtimeLogRoot: "/cache/logs",
      worktreePaths: [
        "/repo/.worktrees/tickets/www-3agy.20-add-manual-cleanup",
        "/repo/.worktrees/tickets/www-3agy.21-other-ticket",
        "/repo/not-workflow/www-3agy.20-add-manual-cleanup",
      ],
      tmuxSessions: [
        "ticket_www-3agy_20_build_1",
        "ticket_www-3agy_20_review_2",
        "ticket_www-3agy_21_build_1",
        "unrelated_www-3agy_20_build_1",
      ],
      evidenceFileNames: [
        "ticket_www-3agy.20_build_1.prompt.md",
        "ticket_www-3agy_20_build_1.stdout.log",
        "ticket_www-3agy.21_build_1.prompt.md",
      ],
    });

    expect(plan.actions).toEqual([
      {
        kind: "remove-worktree",
        path: "/repo/.worktrees/tickets/www-3agy.20-add-manual-cleanup",
      },
    ]);
    expect(plan.reportedTmuxSessions).toEqual([
      "ticket_www-3agy_20_build_1",
      "ticket_www-3agy_20_review_2",
    ]);
    expect(plan.ignoredTmuxSessions).toEqual([
      "ticket_www-3agy_21_build_1",
      "unrelated_www-3agy_20_build_1",
    ]);
    expect(plan.preservedEvidencePaths).toEqual([
      "/cache/logs/ticket_www-3agy.20_build_1.prompt.md",
      "/cache/logs/ticket_www-3agy_20_build_1.stdout.log",
    ]);
  });

  it("removes tmux sessions and evidence only when explicitly requested", () => {
    const plan = planTicketArtifactCleanup({
      ticketId: "www-3agy.20",
      repoRoot: "/repo",
      runtimeLogRoot: "/cache/logs",
      worktreePaths: [],
      tmuxSessions: ["ticket_www-3agy_20_mergefix_1", "ticket_www-3agy_22_mergefix_1"],
      evidenceFileNames: [
        "ticket_www-3agy.20_mergefix_1.prompt.md",
        "ticket_www-3agy_20_mergefix_1.stderr.log",
      ],
      killTmuxSessions: true,
      removeEvidence: true,
    });

    expect(plan.actions).toEqual([
      { kind: "kill-tmux-session", sessionName: "ticket_www-3agy_20_mergefix_1" },
      { kind: "remove-evidence", path: "/cache/logs/ticket_www-3agy.20_mergefix_1.prompt.md" },
      { kind: "remove-evidence", path: "/cache/logs/ticket_www-3agy_20_mergefix_1.stderr.log" },
    ]);
    expect(plan.reportedTmuxSessions).toEqual([]);
    expect(plan.preservedEvidencePaths).toEqual([]);
    expect(plan.ignoredTmuxSessions).toEqual(["ticket_www-3agy_22_mergefix_1"]);
  });
});
