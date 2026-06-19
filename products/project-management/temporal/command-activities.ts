import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const TICKET_WORKTREE_ROOT = ".worktrees/tickets";

export const TMUX_SESSION_KINDS = ["build", "review", "mergefix"] as const;

export type TmuxSessionKind = (typeof TMUX_SESSION_KINDS)[number];

export type ActivityCommand = {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly stdin?: string;
  readonly env?: Readonly<Record<string, string>>;
};

export type ActivityCommandResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

export type ActivityCommandRunner = (command: ActivityCommand) => Promise<ActivityCommandResult>;

export type ActivityRecord = {
  readonly activity: string;
  readonly command: ActivityCommand;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

export type FinalGateCommand = {
  readonly label: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
};

export type UpdateMainInput = {
  readonly repoRoot: string;
};

export type MergeTicketBranchInput = {
  readonly repoRoot: string;
  readonly branch: string;
  readonly commitSha?: string;
  readonly strategy: "cherry-pick" | "merge";
};

export type RunFinalGatesInput = {
  readonly repoRoot: string;
  readonly gates: readonly FinalGateCommand[];
};

export type PushMainInput = {
  readonly repoRoot: string;
};

export type CloseTicketInput = {
  readonly ticketId: string;
  readonly repoRoot: string;
};

export type MergeActivityResult = {
  readonly ok: boolean;
  readonly records: readonly ActivityRecord[];
};

export type TicketNamingInput = {
  readonly repoRoot: string;
  readonly ticketId: string;
  readonly title: string;
};

export type TicketWorktreeNames = {
  readonly branchName: string;
  readonly worktreePath: string;
  readonly slug: string;
};

export type TmuxSessionInput = {
  readonly ticketId: string;
  readonly kind: TmuxSessionKind;
  readonly attempt: number;
};

export type ParsedTmuxSessionName = TmuxSessionInput & {
  readonly ticketId: string;
};

export type CreateTicketWorktreeInput = TicketNamingInput & {
  readonly baseRef?: string;
};

export type CreateTicketWorktreeResult = TicketWorktreeNames & {
  readonly records: readonly ActivityRecord[];
};

export type StartTmuxCommandInput = TmuxSessionInput & {
  readonly cwd: string;
  readonly command: readonly string[];
  readonly runtimeLogRoot?: string;
};

export type StartTmuxCommandResult = {
  readonly sessionName: string;
  readonly stdoutLogPath: string;
  readonly stderrLogPath: string;
  readonly records: readonly ActivityRecord[];
};

export type InspectTmuxSessionInput = {
  readonly sessionName: string;
};

export type InspectTmuxSessionResult = {
  readonly sessionName: string;
  readonly alive: boolean;
  readonly record: ActivityRecord;
};

export function ticketWorktreeNames(input: TicketNamingInput): TicketWorktreeNames {
  const slug = slugifyTicketTitle(input.title);
  const leafName = `${input.ticketId}-${slug}`;
  return {
    branchName: leafName,
    worktreePath: join(input.repoRoot, TICKET_WORKTREE_ROOT, leafName),
    slug,
  };
}

export function tmuxSessionName(input: TmuxSessionInput): string {
  assertPositiveAttempt(input.attempt);
  assertTmuxTicketId(input.ticketId);
  return `ticket_${input.ticketId}_${input.kind}_${input.attempt}`;
}

export function classifyTmuxSessionName(sessionName: string): ParsedTmuxSessionName | null {
  const match = /^ticket_(.+)_(build|review|mergefix)_([1-9]\d*)$/.exec(sessionName);
  if (!match) return null;
  const [, ticketId, kind, attemptText] = match;
  return {
    ticketId,
    kind: kind as TmuxSessionKind,
    attempt: Number(attemptText),
  };
}

export function defaultRuntimeLogRoot(): string {
  return join(
    Bun.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"),
    "world-wide-webb",
    "project-management",
    "logs",
  );
}

export async function createTicketWorktreeActivity(
  input: CreateTicketWorktreeInput,
): Promise<CreateTicketWorktreeResult> {
  return createTicketWorktree(input, runCommand);
}

export async function startTmuxCommandActivity(
  input: StartTmuxCommandInput,
): Promise<StartTmuxCommandResult> {
  return startTmuxCommand(input, runCommand);
}

export async function inspectTmuxSessionActivity(
  input: InspectTmuxSessionInput,
): Promise<InspectTmuxSessionResult> {
  return inspectTmuxSession(input, runCommand);
}

export async function updateMainActivity(input: UpdateMainInput): Promise<MergeActivityResult> {
  return updateMain(input, runCommand);
}

export async function mergeTicketBranchActivity(
  input: MergeTicketBranchInput,
): Promise<MergeActivityResult> {
  return mergeTicketBranch(input, runCommand);
}

export async function runFinalGatesActivity(
  input: RunFinalGatesInput,
): Promise<MergeActivityResult> {
  return runFinalGates(input, runCommand);
}

export async function pushMainActivity(input: PushMainInput): Promise<MergeActivityResult> {
  return pushMain(input, runCommand);
}

export async function closeTicketActivity(input: CloseTicketInput): Promise<MergeActivityResult> {
  return closeTicket(input, runCommand);
}

export async function createTicketWorktree(
  input: CreateTicketWorktreeInput,
  run: ActivityCommandRunner,
): Promise<CreateTicketWorktreeResult> {
  const names = ticketWorktreeNames(input);
  const records = [
    await runRecorded("create-worktree-parent", run, {
      command: "mkdir",
      args: ["-p", dirname(names.worktreePath)],
      cwd: input.repoRoot,
    }),
    await runRecorded("create-worktree", run, {
      command: "git",
      args: [
        "worktree",
        "add",
        "-b",
        names.branchName,
        names.worktreePath,
        input.baseRef ?? "HEAD",
      ],
      cwd: input.repoRoot,
    }),
  ];

  return { ...names, records };
}

export async function startTmuxCommand(
  input: StartTmuxCommandInput,
  run: ActivityCommandRunner,
): Promise<StartTmuxCommandResult> {
  const sessionName = tmuxSessionName(input);
  const logRoot = input.runtimeLogRoot ?? defaultRuntimeLogRoot();
  const stdoutLogPath = join(logRoot, `${sessionName}.stdout.log`);
  const stderrLogPath = join(logRoot, `${sessionName}.stderr.log`);
  const shellCommand = `${shellJoin(input.command)} > ${shellQuote(stdoutLogPath)} 2> ${shellQuote(stderrLogPath)}`;
  const records = [
    await runRecorded("create-tmux-log-dir", run, {
      command: "mkdir",
      args: ["-p", logRoot],
    }),
    await runRecorded("start-tmux-command", run, {
      command: "tmux",
      args: ["new-session", "-d", "-s", sessionName, "-c", input.cwd, shellCommand],
    }),
  ];

  return { sessionName, stdoutLogPath, stderrLogPath, records };
}

export async function inspectTmuxSession(
  input: InspectTmuxSessionInput,
  run: ActivityCommandRunner,
): Promise<InspectTmuxSessionResult> {
  const command: ActivityCommand = {
    command: "tmux",
    args: ["has-session", "-t", input.sessionName],
  };
  const result = await run(command);
  const record = commandRecord("inspect-tmux-session", command, result);
  return { sessionName: input.sessionName, alive: result.exitCode === 0, record };
}

export async function updateMain(
  input: UpdateMainInput,
  run: ActivityCommandRunner,
): Promise<MergeActivityResult> {
  return runMergeCommands(run, [
    {
      activity: "fetch-main",
      command: { command: "git", args: ["fetch", "origin", "main"], cwd: input.repoRoot },
    },
    {
      activity: "checkout-main",
      command: { command: "git", args: ["checkout", "main"], cwd: input.repoRoot },
    },
    {
      activity: "pull-main",
      command: {
        command: "git",
        args: ["pull", "--ff-only", "origin", "main"],
        cwd: input.repoRoot,
      },
    },
  ]);
}

export async function mergeTicketBranch(
  input: MergeTicketBranchInput,
  run: ActivityCommandRunner,
): Promise<MergeActivityResult> {
  const target =
    input.strategy === "cherry-pick" ? (input.commitSha ?? input.branch) : input.branch;
  const args =
    input.strategy === "cherry-pick" ? ["cherry-pick", target] : ["merge", "--no-ff", input.branch];

  return runMergeCommands(run, [
    {
      activity: input.strategy,
      command: { command: "git", args, cwd: input.repoRoot },
    },
  ]);
}

export async function runFinalGates(
  input: RunFinalGatesInput,
  run: ActivityCommandRunner,
): Promise<MergeActivityResult> {
  return runMergeCommands(
    run,
    input.gates.map((gate) => ({
      activity: `final-gate:${gate.label}`,
      command: {
        command: gate.command,
        args: gate.args,
        cwd: gate.cwd ?? input.repoRoot,
      },
    })),
  );
}

export async function pushMain(
  input: PushMainInput,
  run: ActivityCommandRunner,
): Promise<MergeActivityResult> {
  return runMergeCommands(run, [
    {
      activity: "push-main",
      command: { command: "git", args: ["push", "origin", "main"], cwd: input.repoRoot },
    },
  ]);
}

export async function closeTicket(
  input: CloseTicketInput,
  run: ActivityCommandRunner,
): Promise<MergeActivityResult> {
  return runMergeCommands(run, [
    {
      activity: "close-ticket",
      command: {
        command: "bd",
        args: [
          "close",
          input.ticketId,
          "--reason",
          "Merged to main after serialized merge workflow",
        ],
        cwd: input.repoRoot,
      },
    },
  ]);
}

export async function runCommand(command: ActivityCommand): Promise<ActivityCommandResult> {
  const proc = Bun.spawn([command.command, ...command.args], {
    cwd: command.cwd,
    stdin: command.stdin ? "pipe" : "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: command.env ? { ...Bun.env, ...command.env } : undefined,
  });

  if (command.stdin) {
    proc.stdin?.write(command.stdin);
    proc.stdin?.end();
  }

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

async function runRecorded(
  activity: string,
  run: ActivityCommandRunner,
  command: ActivityCommand,
): Promise<ActivityRecord> {
  const result = await run(command);
  const record = commandRecord(activity, command, result);
  if (result.exitCode !== 0) {
    throw new Error(`${command.command} ${command.args.join(" ")} exited ${result.exitCode}`);
  }
  return record;
}

function commandRecord(
  activity: string,
  command: ActivityCommand,
  result: ActivityCommandResult,
): ActivityRecord {
  return {
    activity,
    command,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function runMergeCommands(
  run: ActivityCommandRunner,
  commands: readonly { readonly activity: string; readonly command: ActivityCommand }[],
): Promise<MergeActivityResult> {
  const records: ActivityRecord[] = [];
  for (const entry of commands) {
    const result = await run(entry.command);
    const record = commandRecord(entry.activity, entry.command, result);
    records.push(record);
    if (result.exitCode !== 0) return { ok: false, records };
  }
  return { ok: true, records };
}

function slugifyTicketTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "ticket";
}

function assertPositiveAttempt(attempt: number): void {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error(`tmux attempt must be a positive integer, got ${attempt}`);
  }
}

function assertTmuxTicketId(ticketId: string): void {
  if (!/^[a-zA-Z0-9_.-]+$/.test(ticketId)) {
    throw new Error(`ticket id is not safe for deterministic tmux session names: ${ticketId}`);
  }
}

function shellJoin(command: readonly string[]): string {
  if (command.length === 0) throw new Error("tmux command must not be empty");
  return command.map(shellQuote).join(" ");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
