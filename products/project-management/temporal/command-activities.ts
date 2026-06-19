import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  buildCommentCommand,
  buildMetadataCommand,
  TICKET_WORKFLOW_LABELS,
  type TicketCommentKind,
  type TicketWorkflowMetadata,
} from "../beads-adapter";

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

export type ResolveGitHeadInput = {
  readonly repoRoot: string;
  readonly ref: string;
};

export type ResolveGitHeadResult = {
  readonly ok: boolean;
  readonly commitSha: string | null;
  readonly records: readonly ActivityRecord[];
};

export type ResolveOpenCodeSessionInput = {
  readonly worktreePath: string;
  readonly agent: string;
  readonly startedAfterMs?: number;
};

export type ResolveOpenCodeSessionResult = {
  readonly ok: boolean;
  readonly sessionId: string | null;
  readonly title: string | null;
  readonly records: readonly ActivityRecord[];
};

export type PushMainInput = {
  readonly repoRoot: string;
};

export type CloseTicketInput = {
  readonly ticketId: string;
  readonly repoRoot: string;
};

export type PushBeadsInput = {
  readonly repoRoot: string;
};

export type EscalateTicketHumanInput = {
  readonly ticketId: string;
  readonly repoRoot: string;
  readonly reason: string;
};

export type TicketBeadsInput = {
  readonly ticketId: string;
  readonly repoRoot: string;
};

export type WriteTicketMetadataInput = TicketBeadsInput & {
  readonly metadata: TicketWorkflowMetadata;
};

export type WriteTicketCommentInput = TicketBeadsInput & {
  readonly kind: TicketCommentKind;
  readonly body: string;
};

export type VerifyTicketHandoffInput = TicketBeadsInput;

export type BuilderHandoffResult = MergeActivityResult & {
  readonly handoff: "review" | "missing";
  readonly labels: readonly string[];
  readonly hasBuilderComment: boolean;
};

export type ReviewerHandoffResult = MergeActivityResult & {
  readonly handoff: "verified" | "retry" | "human" | "missing" | "ambiguous";
  readonly labels: readonly string[];
  readonly hasReviewerComment: boolean;
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
  readonly startedAtMs: number;
  readonly stdoutLogPath: string;
  readonly stderrLogPath: string;
  readonly exitCodePath: string;
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

export type WaitForTmuxSessionInput = {
  readonly sessionName: string;
  readonly stdoutLogPath: string;
  readonly stderrLogPath: string;
  readonly exitCodePath?: string;
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
};

export type WaitForTmuxSessionResult = {
  readonly sessionName: string;
  readonly completed: boolean;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly records: readonly ActivityRecord[];
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
  return `ticket_${tmuxSafeTicketId(input.ticketId)}_${input.kind}_${input.attempt}`;
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

export async function waitForAgentRunCompletionActivity(
  input: WaitForTmuxSessionInput,
): Promise<WaitForTmuxSessionResult> {
  return waitForTmuxSession(input, runCommand);
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

export async function resolveGitHeadActivity(
  input: ResolveGitHeadInput,
): Promise<ResolveGitHeadResult> {
  return resolveGitHead(input, runCommand);
}

export async function resolveOpenCodeSessionActivity(
  input: ResolveOpenCodeSessionInput,
): Promise<ResolveOpenCodeSessionResult> {
  return resolveOpenCodeSession(input, runCommand);
}

export async function pushMainActivity(input: PushMainInput): Promise<MergeActivityResult> {
  return pushMain(input, runCommand);
}

export async function closeTicketActivity(input: CloseTicketInput): Promise<MergeActivityResult> {
  return closeTicket(input, runCommand);
}

export async function pushBeadsActivity(input: PushBeadsInput): Promise<MergeActivityResult> {
  return pushBeads(input, runCommand);
}

export async function claimTicketActivity(input: TicketBeadsInput): Promise<MergeActivityResult> {
  return claimTicket(input, runCommand);
}

export async function writeTicketWorkflowMetadataActivity(
  input: WriteTicketMetadataInput,
): Promise<MergeActivityResult> {
  return writeTicketWorkflowMetadata(input, runCommand);
}

export async function writeTicketCommentActivity(
  input: WriteTicketCommentInput,
): Promise<MergeActivityResult> {
  return writeTicketComment(input, runCommand);
}

export async function moveTicketToReviewActivity(
  input: TicketBeadsInput,
): Promise<MergeActivityResult> {
  return moveTicketToReview(input, runCommand);
}

export async function moveTicketToVerifiedActivity(
  input: TicketBeadsInput,
): Promise<MergeActivityResult> {
  return moveTicketToVerified(input, runCommand);
}

export async function verifyBuilderHandoffActivity(
  input: VerifyTicketHandoffInput,
): Promise<BuilderHandoffResult> {
  return verifyBuilderHandoff(input, runCommand);
}

export async function verifyReviewerHandoffActivity(
  input: VerifyTicketHandoffInput,
): Promise<ReviewerHandoffResult> {
  return verifyReviewerHandoff(input, runCommand);
}

export async function escalateTicketHumanActivity(
  input: EscalateTicketHumanInput,
): Promise<MergeActivityResult> {
  return escalateTicketHuman(input, runCommand);
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
  const exitCodePath = join(logRoot, `${sessionName}.exitcode`);
  const shellCommand = `(${shellJoin(input.command)} > ${shellQuote(stdoutLogPath)} 2> ${shellQuote(stderrLogPath)}); printf '%s' "$?" > ${shellQuote(exitCodePath)}`;
  const startedAtMs = Date.now();
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

  return { sessionName, startedAtMs, stdoutLogPath, stderrLogPath, exitCodePath, records };
}

export async function inspectTmuxSession(
  input: InspectTmuxSessionInput,
  run: ActivityCommandRunner,
): Promise<InspectTmuxSessionResult> {
  const command: ActivityCommand = {
    command: "tmux",
    args: ["has-session", "-t", `=${input.sessionName}`],
  };
  const result = await run(command);
  const record = commandRecord("inspect-tmux-session", command, result);
  return { sessionName: input.sessionName, alive: result.exitCode === 0, record };
}

export async function waitForTmuxSession(
  input: WaitForTmuxSessionInput,
  run: ActivityCommandRunner,
): Promise<WaitForTmuxSessionResult> {
  const timeoutMs = input.timeoutMs ?? 10 * 60_000;
  const pollIntervalMs = input.pollIntervalMs ?? 2_000;
  const startedAt = Date.now();
  const records: ActivityRecord[] = [];

  while (Date.now() - startedAt <= timeoutMs) {
    const inspected = await inspectTmuxSession({ sessionName: input.sessionName }, run);
    records.push(inspected.record);
    if (!inspected.alive) {
      return {
        sessionName: input.sessionName,
        completed: true,
        exitCode: input.exitCodePath
          ? parseExitCode(await readLogFile(input.exitCodePath, run))
          : null,
        stdout: await readLogFile(input.stdoutLogPath, run),
        stderr: await readLogFile(input.stderrLogPath, run),
        records,
      };
    }
    await sleep(pollIntervalMs);
  }

  return {
    sessionName: input.sessionName,
    completed: false,
    exitCode: input.exitCodePath ? parseExitCode(await readLogFile(input.exitCodePath, run)) : null,
    stdout: await readLogFile(input.stdoutLogPath, run),
    stderr: await readLogFile(input.stderrLogPath, run),
    records,
  };
}

function parseExitCode(value: string): number | null {
  const parsed = Number(value.trim());
  return Number.isInteger(parsed) ? parsed : null;
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

export async function resolveGitHead(
  input: ResolveGitHeadInput,
  run: ActivityCommandRunner,
): Promise<ResolveGitHeadResult> {
  const result = await run({
    command: "git",
    args: ["rev-parse", "--verify", `${input.ref}^{commit}`],
    cwd: input.repoRoot,
  });
  const records = [
    commandRecord(
      "resolve-git-head",
      {
        command: "git",
        args: ["rev-parse", "--verify", `${input.ref}^{commit}`],
        cwd: input.repoRoot,
      },
      result,
    ),
  ];
  const commitSha = result.exitCode === 0 ? result.stdout.trim() || null : null;
  return { ok: commitSha !== null, commitSha, records };
}

export async function resolveOpenCodeSession(
  input: ResolveOpenCodeSessionInput,
  run: ActivityCommandRunner,
): Promise<ResolveOpenCodeSessionResult> {
  const dbPath = join(homedir(), ".local/share/opencode/opencode.db");
  const records: ActivityRecord[] = [];

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const filters = [
      `directory = ${quoteSql(input.worktreePath)}`,
      `agent = ${quoteSql(input.agent)}`,
      ...(input.startedAfterMs ? [`time_updated >= ${input.startedAfterMs}`] : []),
    ];
    const sql = [
      "select id || char(9) || title from session",
      `where ${filters.join(" and ")}`,
      "order by time_updated desc limit 1;",
    ].join(" ");
    const command = { command: "sqlite3", args: ["-readonly", dbPath, sql] };
    const result = await run(command);
    const record = commandRecord("resolve-opencode-session", command, result);
    records.push(record);
    const [sessionId, title] = record.stdout.trim().split("\t");
    if (record.exitCode === 0 && sessionId) {
      return { ok: true, sessionId, title: title || null, records };
    }
    await sleep(250);
  }

  return { ok: false, sessionId: null, title: null, records };
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

export async function pushBeads(
  input: PushBeadsInput,
  run: ActivityCommandRunner,
): Promise<MergeActivityResult> {
  return runMergeCommands(run, [
    {
      activity: "push-beads",
      command: { command: "bd", args: ["dolt", "push"], cwd: input.repoRoot },
    },
  ]);
}

export async function claimTicket(
  input: TicketBeadsInput,
  run: ActivityCommandRunner,
): Promise<MergeActivityResult> {
  return runMergeCommands(run, [
    {
      activity: "claim-ticket",
      command: { command: "bd", args: ["update", input.ticketId, "--claim"], cwd: input.repoRoot },
    },
  ]);
}

export async function writeTicketWorkflowMetadata(
  input: WriteTicketMetadataInput,
  run: ActivityCommandRunner,
): Promise<MergeActivityResult> {
  const command = buildMetadataCommand(input.ticketId, input.metadata);
  return runMergeCommands(run, [
    {
      activity: "write-ticket-metadata",
      command: {
        command: command.command,
        args: command.args,
        stdin: command.stdin,
        cwd: input.repoRoot,
      },
    },
  ]);
}

export async function writeTicketComment(
  input: WriteTicketCommentInput,
  run: ActivityCommandRunner,
): Promise<MergeActivityResult> {
  const command = buildCommentCommand(input.ticketId, input.kind, input.body);
  return runMergeCommands(run, [
    {
      activity: `write-${input.kind}`,
      command: {
        command: command.command,
        args: command.args,
        stdin: command.stdin,
        cwd: input.repoRoot,
      },
    },
  ]);
}

export async function moveTicketToReview(
  input: TicketBeadsInput,
  run: ActivityCommandRunner,
): Promise<MergeActivityResult> {
  return runMergeCommands(run, [
    {
      activity: "move-ticket-review",
      command: {
        command: "bd",
        args: [
          "update",
          input.ticketId,
          "--add-label",
          TICKET_WORKFLOW_LABELS.review,
          "--remove-label",
          TICKET_WORKFLOW_LABELS.ready,
          "--remove-label",
          TICKET_WORKFLOW_LABELS.retry,
        ],
        cwd: input.repoRoot,
      },
    },
  ]);
}

export async function moveTicketToVerified(
  input: TicketBeadsInput,
  run: ActivityCommandRunner,
): Promise<MergeActivityResult> {
  return runMergeCommands(run, [
    {
      activity: "move-ticket-verified",
      command: {
        command: "bd",
        args: [
          "update",
          input.ticketId,
          "--add-label",
          TICKET_WORKFLOW_LABELS.verified,
          "--remove-label",
          TICKET_WORKFLOW_LABELS.review,
          "--remove-label",
          TICKET_WORKFLOW_LABELS.ready,
          "--remove-label",
          TICKET_WORKFLOW_LABELS.retry,
        ],
        cwd: input.repoRoot,
      },
    },
  ]);
}

export async function verifyBuilderHandoff(
  input: VerifyTicketHandoffInput,
  run: ActivityCommandRunner,
): Promise<BuilderHandoffResult> {
  const record = await runShowTicket(input, run, "verify-builder-handoff");
  if (record.exitCode !== 0) {
    return {
      ok: false,
      records: [record],
      handoff: "missing",
      labels: [],
      hasBuilderComment: false,
    };
  }

  const ticket = parseShownTicket(record.stdout);
  const labels = ticket?.labels ?? [];
  const hasBuilderComment =
    ticket?.comments.some((comment) =>
      /builder (summary|handoff)|## builder summary/i.test(comment),
    ) ?? false;
  const handoff =
    labels.includes(TICKET_WORKFLOW_LABELS.review) && hasBuilderComment ? "review" : "missing";

  return { ok: handoff === "review", records: [record], handoff, labels, hasBuilderComment };
}

export async function verifyReviewerHandoff(
  input: VerifyTicketHandoffInput,
  run: ActivityCommandRunner,
): Promise<ReviewerHandoffResult> {
  const record = await runShowTicket(input, run, "verify-reviewer-handoff");
  if (record.exitCode !== 0) {
    return {
      ok: false,
      records: [record],
      handoff: "missing",
      labels: [],
      hasReviewerComment: false,
    };
  }

  const ticket = parseShownTicket(record.stdout);
  const labels = ticket?.labels ?? [];
  const outcomes = [
    ["verified", TICKET_WORKFLOW_LABELS.verified],
    ["retry", TICKET_WORKFLOW_LABELS.retry],
    ["human", TICKET_WORKFLOW_LABELS.human],
  ] as const;
  const present = outcomes.filter(([, label]) => labels.includes(label));
  const hasReviewerComment =
    ticket?.comments.some((comment) =>
      /reviewer (findings|handoff)|## reviewer findings/i.test(comment),
    ) ?? false;
  const handoff = !hasReviewerComment
    ? "missing"
    : present.length === 1
      ? present[0][0]
      : present.length === 0
        ? "missing"
        : "ambiguous";

  return {
    ok: handoff === "verified" || handoff === "retry" || handoff === "human",
    records: [record],
    handoff,
    labels,
    hasReviewerComment,
  };
}

export async function escalateTicketHuman(
  input: EscalateTicketHumanInput,
  run: ActivityCommandRunner,
): Promise<MergeActivityResult> {
  return runMergeCommands(run, [
    {
      activity: "mark-ticket-human",
      command: {
        command: "bd",
        args: [
          "update",
          input.ticketId,
          "--add-label",
          TICKET_WORKFLOW_LABELS.human,
          "--remove-label",
          TICKET_WORKFLOW_LABELS.ready,
          "--remove-label",
          TICKET_WORKFLOW_LABELS.review,
          "--remove-label",
          TICKET_WORKFLOW_LABELS.verified,
        ],
        cwd: input.repoRoot,
      },
    },
    {
      activity: "comment-ticket-escalation",
      command: {
        command: "bd",
        args: ["comment", input.ticketId, "--stdin"],
        cwd: input.repoRoot,
        stdin: `## Escalation\n\n${input.reason}`,
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

async function readLogFile(path: string, run: ActivityCommandRunner): Promise<string> {
  const result = await run({
    command: "sh",
    args: ["-c", 'cat "$1" 2>/dev/null || true', "sh", path],
  });
  return result.stdout;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function runShowTicket(
  input: TicketBeadsInput,
  run: ActivityCommandRunner,
  activity: string,
): Promise<ActivityRecord> {
  const result = await run({
    command: "bd",
    args: ["show", input.ticketId, "--json", "--include-comments"],
    cwd: input.repoRoot,
  });
  return commandRecord(
    activity,
    {
      command: "bd",
      args: ["show", input.ticketId, "--json", "--include-comments"],
      cwd: input.repoRoot,
    },
    result,
  );
}

type ShownTicket = {
  readonly labels: readonly string[];
  readonly comments: readonly string[];
};

function parseShownTicket(stdout: string): ShownTicket | null {
  const parsed: unknown = JSON.parse(stdout);
  const value = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  return {
    labels: parseStringArray(candidate.labels),
    comments: parseCommentBodies(candidate.comments),
  };
}

function parseStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function parseCommentBodies(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((comment) => {
    if (typeof comment === "string") return [comment];
    if (!comment || typeof comment !== "object") return [];
    const candidate = comment as Record<string, unknown>;
    for (const key of ["text", "body", "comment", "content"] as const) {
      if (typeof candidate[key] === "string") return [candidate[key]];
    }
    return [];
  });
}

function quoteSql(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
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

function tmuxSafeTicketId(ticketId: string): string {
  return ticketId.replaceAll(".", "_");
}

function shellJoin(command: readonly string[]): string {
  if (command.length === 0) throw new Error("tmux command must not be empty");
  return command.map(shellQuote).join(" ");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
