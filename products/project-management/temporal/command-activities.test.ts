import { describe, expect, it } from "vitest";
import {
  type ActivityCommand,
  type ActivityCommandRunner,
  classifyTmuxSessionName,
  closeTicket,
  createTicketWorktree,
  escalateTicketHuman,
  inspectTmuxSession,
  mergeTicketBranch,
  pushBeads,
  pushMain,
  readReadyTicketWorkflowQueue,
  resolveOpenCodeSession,
  runFinalGates,
  startTmuxCommand,
  ticketWorktreeNames,
  tmuxSessionName,
  updateMain,
  verifyBuilderHandoff,
  verifyReviewerHandoff,
  waitForTmuxSession,
} from "./command-activities";

describe("ticket activity naming", () => {
  it("places worktrees under .worktrees/tickets and starts branch names with the ticket id", () => {
    expect(
      ticketWorktreeNames({
        repoRoot: "/repo",
        ticketId: "www-3agy.8",
        title: "Implement worktree and tmux Activities",
      }),
    ).toEqual({
      branchName: "www-3agy.8-implement-worktree-and-tmux-activities",
      worktreePath: "/repo/.worktrees/tickets/www-3agy.8-implement-worktree-and-tmux-activities",
      slug: "implement-worktree-and-tmux-activities",
    });
  });

  it("builds deterministic tmux session names and classifies known phases", () => {
    expect(tmuxSessionName({ ticketId: "www-3agy.8", kind: "review", attempt: 1 })).toBe(
      "ticket_www-3agy_8_review_1",
    );
    expect(tmuxSessionName({ ticketId: "www-3agy.8", kind: "mergefix", attempt: 3 })).toBe(
      "ticket_www-3agy_8_mergefix_3",
    );

    expect(tmuxSessionName({ ticketId: "www-3agy.8", kind: "build", attempt: 2 })).toBe(
      "ticket_www-3agy_8_build_2",
    );
    expect(classifyTmuxSessionName("ticket_www-3agy_8_review_1")).toEqual({
      ticketId: "www-3agy_8",
      kind: "review",
      attempt: 1,
    });
    expect(classifyTmuxSessionName("ticket_www-3agy_8_unknown_1")).toBeNull();
    expect(classifyTmuxSessionName("ticket_www-3agy_8_build_0")).toBeNull();
  });
});

describe("ticket command activities", () => {
  it("refreshes origin/main before creating a worktree from that base ref", async () => {
    const { run, commands } = fakeRunner();
    const result = await createTicketWorktree(
      {
        repoRoot: "/repo",
        ticketId: "www-3agy.8",
        title: "Implement worktree and tmux Activities",
        baseRef: "origin/main",
      },
      run,
    );

    expect(result.branchName.startsWith("www-3agy.8")).toBe(true);
    expect(commands).toEqual([
      {
        command: "git",
        args: ["fetch", "origin", "main:refs/remotes/origin/main"],
        cwd: "/repo",
      },
      {
        command: "mkdir",
        args: ["-p", "/repo/.worktrees/tickets"],
        cwd: "/repo",
      },
      {
        command: "git",
        args: [
          "worktree",
          "add",
          "-b",
          "www-3agy.8-implement-worktree-and-tmux-activities",
          "/repo/.worktrees/tickets/www-3agy.8-implement-worktree-and-tmux-activities",
          "origin/main",
        ],
        cwd: "/repo",
      },
    ]);
    expect(result.records.map((record) => record.command)).toEqual(commands);
  });

  it("starts OpenCode-like commands in deterministic tmux sessions with stdout/stderr logs", async () => {
    const { run, commands } = fakeRunner();
    const result = await startTmuxCommand(
      {
        ticketId: "www-3agy.8",
        kind: "build",
        attempt: 1,
        cwd: "/repo/.worktrees/tickets/www-3agy.8-implement-worktree-and-tmux-activities",
        command: ["opencode", "run", "--model", "sonnet", "Build it"],
        runtimeLogRoot: "/cache/project-management/logs",
      },
      run,
    );

    expect(result).toEqual(
      expect.objectContaining({
        sessionName: "ticket_www-3agy_8_build_1",
        stdoutLogPath: "/cache/project-management/logs/ticket_www-3agy_8_build_1.stdout.log",
        stderrLogPath: "/cache/project-management/logs/ticket_www-3agy_8_build_1.stderr.log",
        exitCodePath: "/cache/project-management/logs/ticket_www-3agy_8_build_1.exitcode",
      }),
    );
    expect(commands[0]).toEqual({
      command: "mkdir",
      args: ["-p", "/cache/project-management/logs"],
    });
    expect(commands[1]).toEqual({
      command: "tmux",
      args: [
        "new-session",
        "-d",
        "-s",
        "ticket_www-3agy_8_build_1",
        "-c",
        "/repo/.worktrees/tickets/www-3agy.8-implement-worktree-and-tmux-activities",
        "('opencode' 'run' '--model' 'sonnet' 'Build it' > '/cache/project-management/logs/ticket_www-3agy_8_build_1.stdout.log' 2> '/cache/project-management/logs/ticket_www-3agy_8_build_1.stderr.log'); printf '%s' \"$?\" > '/cache/project-management/logs/ticket_www-3agy_8_build_1.exitcode'",
      ],
    });
    expect(result.records.map((record) => record.command)).toEqual(commands);
  });

  it("inspects tmux liveness through fake tmux has-session", async () => {
    const alive = await inspectTmuxSession(
      { sessionName: "ticket_www-3agy_8_review_1" },
      fakeTmuxStatusRunner(true),
    );
    const dead = await inspectTmuxSession(
      { sessionName: "ticket_www-3agy_8_review_1" },
      fakeTmuxStatusRunner(false),
    );

    expect(alive.alive).toBe(true);
    expect(dead.alive).toBe(false);
    expect(alive.record.command).toEqual({
      command: "tmux",
      args: ["has-session", "-t", "=ticket_www-3agy_8_review_1"],
    });
  });

  it("waits for tmux completion and reads stdout/stderr logs", async () => {
    const commands: ActivityCommand[] = [];
    let inspectCount = 0;
    const result = await waitForTmuxSession(
      {
        sessionName: "ticket_www-3agy_17_build_1",
        stdoutLogPath: "/cache/stdout.log",
        stderrLogPath: "/cache/stderr.log",
        exitCodePath: "/cache/exitcode.log",
        pollIntervalMs: 1,
        timeoutMs: 100,
      },
      async (command) => {
        commands.push(command);
        if (command.command === "tmux") {
          inspectCount += 1;
          return { exitCode: inspectCount === 1 ? 0 : 1, stdout: "", stderr: "" };
        }
        if (command.args.includes("/cache/stdout.log")) {
          return { exitCode: 0, stdout: "agent output", stderr: "" };
        }
        if (command.args.includes("/cache/exitcode.log")) {
          return { exitCode: 0, stdout: "0", stderr: "" };
        }
        return { exitCode: 0, stdout: "agent errors", stderr: "" };
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        completed: true,
        exitCode: 0,
        stdout: "agent output",
        stderr: "agent errors",
      }),
    );
    expect(commands.filter((command) => command.command === "tmux")).toHaveLength(2);
  });

  it("updates main before deterministic merge and only pushes or closes through explicit commands", async () => {
    const { run, commands } = fakeRunner();

    await updateMain({ repoRoot: "/repo" }, run);
    await mergeTicketBranch(
      {
        repoRoot: "/repo",
        branch: "www-3agy.11-ticket-workflow",
        commitSha: "abc123",
        strategy: "cherry-pick",
      },
      run,
    );
    await runFinalGates(
      {
        repoRoot: "/repo",
        gates: [{ label: "test", command: "bun", args: ["run", "test"] }],
      },
      run,
    );
    await pushMain({ repoRoot: "/repo" }, run);
    await closeTicket({ repoRoot: "/repo", ticketId: "www-3agy.11" }, run);
    await pushBeads({ repoRoot: "/repo" }, run);

    expect(commands).toEqual([
      { command: "git", args: ["fetch", "origin", "main"], cwd: "/repo" },
      { command: "git", args: ["checkout", "main"], cwd: "/repo" },
      { command: "git", args: ["pull", "--ff-only", "origin", "main"], cwd: "/repo" },
      { command: "git", args: ["cherry-pick", "abc123"], cwd: "/repo" },
      { command: "bun", args: ["run", "test"], cwd: "/repo" },
      { command: "git", args: ["push", "origin", "main"], cwd: "/repo" },
      {
        command: "bd",
        args: [
          "update",
          "www-3agy.11",
          "--set-metadata",
          "ticket_phase=shipped",
          "--set-metadata",
          "ticket_last_result=shipped",
          "--remove-label",
          "ticket-backlog",
          "--remove-label",
          "ticket-queued",
          "--remove-label",
          "ticket-ready",
          "--remove-label",
          "ticket-review",
          "--remove-label",
          "ticket-verified",
          "--remove-label",
          "ticket-retry",
          "--remove-label",
          "ticket-human",
        ],
        cwd: "/repo",
      },
      {
        command: "bd",
        args: [
          "close",
          "www-3agy.11",
          "--reason",
          "Merged to main after serialized merge workflow",
        ],
        cwd: "/repo",
      },
      { command: "bd", args: ["dolt", "push"], cwd: "/repo" },
    ]);
  });

  it("marks auto tickets shipped and clears active workflow labels before close", async () => {
    const { run, commands } = fakeRunner();

    const result = await closeTicket({ repoRoot: "/repo", ticketId: "www-3agy.11" }, run);

    expect(result.ok).toBe(true);
    expect(commands[0]).toEqual({
      command: "bd",
      args: [
        "update",
        "www-3agy.11",
        "--set-metadata",
        "ticket_phase=shipped",
        "--set-metadata",
        "ticket_last_result=shipped",
        "--remove-label",
        "ticket-backlog",
        "--remove-label",
        "ticket-queued",
        "--remove-label",
        "ticket-ready",
        "--remove-label",
        "ticket-review",
        "--remove-label",
        "ticket-verified",
        "--remove-label",
        "ticket-retry",
        "--remove-label",
        "ticket-human",
      ],
      cwd: "/repo",
    });
    expect(commands[1]?.args[0]).toBe("close");
  });

  it("resolves the latest OpenCode session for a worktree and agent", async () => {
    const commands: ActivityCommand[] = [];
    const result = await resolveOpenCodeSession(
      {
        worktreePath: "/repo/.worktrees/tickets/www-proof-proof-ticket",
        agent: "ticket-builder",
      },
      async (command) => {
        commands.push(command);
        return { exitCode: 0, stdout: "ses_builder\tProof ticket\n", stderr: "" };
      },
    );

    expect(result).toEqual(
      expect.objectContaining({ ok: true, sessionId: "ses_builder", title: "Proof ticket" }),
    );
    expect(commands[0]).toEqual(
      expect.objectContaining({
        command: "sqlite3",
        args: expect.arrayContaining(["-readonly"]),
      }),
    );
  });

  it("stops a failing deterministic merge command without running later commands in the Activity", async () => {
    const result = await updateMain({ repoRoot: "/repo" }, async (command) => {
      if (command.args.includes("checkout")) {
        return { exitCode: 1, stdout: "", stderr: "checkout failed" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });

    expect(result.ok).toBe(false);
    expect(result.records.map((record) => record.activity)).toEqual([
      "fetch-main",
      "checkout-main",
    ]);
  });

  it("escalates repeated merge failure to ticket-human without closing the ticket", async () => {
    const { run, commands } = fakeRunner();

    await escalateTicketHuman(
      {
        repoRoot: "/repo",
        ticketId: "www-3agy.12",
        reason: "Merge fix attempts exhausted.",
      },
      run,
    );

    expect(commands).toEqual([
      {
        command: "bd",
        args: [
          "update",
          "www-3agy.12",
          "--add-label",
          "ticket-human",
          "--remove-label",
          "ticket-ready",
          "--remove-label",
          "ticket-review",
          "--remove-label",
          "ticket-verified",
        ],
        cwd: "/repo",
      },
      {
        command: "bd",
        args: ["comment", "www-3agy.12", "--stdin"],
        cwd: "/repo",
        stdin: "## Escalation\n\nMerge fix attempts exhausted.",
      },
    ]);
    expect(commands.flatMap((command) => command.args)).not.toContain("close");
  });

  it("verifies builder handoff from Beads labels and comments", async () => {
    const result = await verifyBuilderHandoff(
      { repoRoot: "/repo", ticketId: "www-3agy.18" },
      async () => ({
        exitCode: 0,
        stdout: JSON.stringify({
          labels: ["ticket-review"],
          comments: [{ body: "## Builder summary\n\nBuilt and pushed abc123." }],
        }),
        stderr: "",
      }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        handoff: "review",
        hasBuilderComment: true,
        labels: ["ticket-review"],
      }),
    );
  });

  it("verifies reviewer handoff from exactly one Beads outcome label", async () => {
    const result = await verifyReviewerHandoff(
      { repoRoot: "/repo", ticketId: "www-3agy.18" },
      async () => ({
        exitCode: 0,
        stdout: JSON.stringify({
          labels: ["ticket-verified"],
          comments: [{ body: "## Reviewer findings\n\nNo findings." }],
        }),
        stderr: "",
      }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        handoff: "verified",
        hasReviewerComment: true,
        labels: ["ticket-verified"],
      }),
    );
  });

  it("rejects ambiguous reviewer outcome labels", async () => {
    const result = await verifyReviewerHandoff(
      { repoRoot: "/repo", ticketId: "www-3agy.18" },
      async () => ({
        exitCode: 0,
        stdout: JSON.stringify({
          labels: ["ticket-verified", "ticket-retry"],
          comments: [{ body: "## Reviewer findings\n\nConflicting labels." }],
        }),
        stderr: "",
      }),
    );

    expect(result).toEqual(expect.objectContaining({ ok: false, handoff: "ambiguous" }));
  });

  it("reads ticket-ready workflow queue details through Beads", async () => {
    const commands: ActivityCommand[] = [];
    const result = await readReadyTicketWorkflowQueue({ repoRoot: "/repo" }, async (command) => {
      commands.push(command);
      if (command.args[0] === "list") {
        return {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              id: "www-3agy.19",
              title: "Start ticket workflow worktrees from latest origin main",
              status: "open",
              labels: ["ticket-ready"],
            },
          ]),
          stderr: "",
        };
      }
      return {
        exitCode: 0,
        stdout: JSON.stringify([
          {
            id: "www-3agy.19",
            title: "Start ticket workflow worktrees from latest origin main",
            status: "open",
            labels: ["ticket-ready"],
            acceptance_criteria: "- [ ] worktree starts from latest main",
            comments: [{ text: "## Builder context\n\nKeep it small." }],
          },
        ]),
        stderr: "",
      };
    });

    expect(result).toEqual([
      {
        ticketId: "www-3agy.19",
        title: "Start ticket workflow worktrees from latest origin main",
        acceptanceCriteria: "- [ ] worktree starts from latest main",
        comments: ["## Builder context\n\nKeep it small."],
      },
    ]);
    expect(commands.map((command) => command.args[0])).toEqual(["list", "show"]);
    expect(commands[0]).toEqual({
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
      ],
      cwd: "/repo",
      stdin: undefined,
    });
  });

  it("throws a retryable empty-queue failure so Temporal owns polling", async () => {
    await expect(
      readReadyTicketWorkflowQueue({ repoRoot: "/repo" }, async () => ({
        exitCode: 0,
        stdout: "[]",
        stderr: "",
      })),
    ).rejects.toMatchObject({ type: "NoReadyTicketWorkflows", nonRetryable: false });
  });
});

function fakeRunner(): {
  readonly run: ActivityCommandRunner;
  readonly commands: ActivityCommand[];
} {
  const commands: ActivityCommand[] = [];
  return {
    commands,
    run: async (command) => {
      commands.push(command);
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  };
}

function fakeTmuxStatusRunner(alive: boolean): ActivityCommandRunner {
  return async () => ({ exitCode: alive ? 0 : 1, stdout: "", stderr: "" });
}
