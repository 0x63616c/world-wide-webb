import { describe, expect, it } from "vitest";
import {
  type ActivityCommand,
  type ActivityCommandRunner,
  classifyTmuxSessionName,
  createTicketWorktree,
  inspectTmuxSession,
  startTmuxCommand,
  ticketWorktreeNames,
  tmuxSessionName,
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
      "ticket_www-3agy.8_review_1",
    );
    expect(tmuxSessionName({ ticketId: "www-3agy.8", kind: "mergefix", attempt: 3 })).toBe(
      "ticket_www-3agy.8_mergefix_3",
    );

    expect(tmuxSessionName({ ticketId: "www-3agy.8", kind: "build", attempt: 2 })).toBe(
      "ticket_www-3agy.8_build_2",
    );
    expect(classifyTmuxSessionName("ticket_www-3agy.8_review_1")).toEqual({
      ticketId: "www-3agy.8",
      kind: "review",
      attempt: 1,
    });
    expect(classifyTmuxSessionName("ticket_www-3agy.8_unknown_1")).toBeNull();
    expect(classifyTmuxSessionName("ticket_www-3agy.8_build_0")).toBeNull();
  });
});

describe("ticket command activities", () => {
  it("creates the parent directory and git worktree through command records", async () => {
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
        sessionName: "ticket_www-3agy.8_build_1",
        stdoutLogPath: "/cache/project-management/logs/ticket_www-3agy.8_build_1.stdout.log",
        stderrLogPath: "/cache/project-management/logs/ticket_www-3agy.8_build_1.stderr.log",
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
        "ticket_www-3agy.8_build_1",
        "-c",
        "/repo/.worktrees/tickets/www-3agy.8-implement-worktree-and-tmux-activities",
        "'opencode' 'run' '--model' 'sonnet' 'Build it' > '/cache/project-management/logs/ticket_www-3agy.8_build_1.stdout.log' 2> '/cache/project-management/logs/ticket_www-3agy.8_build_1.stderr.log'",
      ],
    });
    expect(result.records.map((record) => record.command)).toEqual(commands);
  });

  it("inspects tmux liveness through fake tmux has-session", async () => {
    const alive = await inspectTmuxSession(
      { sessionName: "ticket_www-3agy.8_review_1" },
      fakeTmuxStatusRunner(true),
    );
    const dead = await inspectTmuxSession(
      { sessionName: "ticket_www-3agy.8_review_1" },
      fakeTmuxStatusRunner(false),
    );

    expect(alive.alive).toBe(true);
    expect(dead.alive).toBe(false);
    expect(alive.record.command).toEqual({
      command: "tmux",
      args: ["has-session", "-t", "ticket_www-3agy.8_review_1"],
    });
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
