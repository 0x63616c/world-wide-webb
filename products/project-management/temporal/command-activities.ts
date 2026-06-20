import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { ApplicationFailure } from "@temporalio/activity";
import { Client, Connection } from "@temporalio/client";
import {
  BeadsAdapter,
  type BeadsTicket,
  type BeadsTicketDetails,
  buildCommentCommand,
  buildFailedReviewRequeueCommand,
  buildMetadataCommand,
  lifecycleTransitionLabelArgs,
  TICKET_METADATA_KEYS,
  TICKET_WORKFLOW_LABELS,
  type TicketCommentKind,
  type TicketWorkflowMetadata,
} from "../beads-adapter";
import {
  planTicketArtifactCleanup,
  type TicketArtifactCleanupAction,
  type TicketArtifactCleanupPlan,
} from "../ticket-artifact-cleanup";
import {
  captureOpenCodeUsageActivitySafe,
  type CaptureOpenCodeUsageInput,
  type CaptureOpenCodeUsageResult,
} from "../opencode-usage";

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

export type TicketWorkflowRuntimeConfig = {
  readonly repoRoot: string;
  readonly finalGates: readonly FinalGateCommand[];
  readonly runtimeLogRoot: string;
  readonly baseRef: string;
  readonly requirePushedBranch: boolean;
  readonly mergeStrategy: "cherry-pick" | "merge";
  readonly ticketQueuePollIntervalMs: number;
  readonly maxActiveTicketWorkflows: number;
  readonly maxTicketsPerPoll: number;
  readonly maxMergeAttempts: number;
  readonly maxMergeHistoryEvents: number;
  readonly stuckTicketRecoveryPollIntervalMs: number;
  readonly stuckTicketRecoveryMaxTicketsPerPoll: number;
  readonly temporalAddress: string;
  readonly temporalNamespace: string;
};

export type TicketWorkflowTicketDetailsInput = {
  readonly ticketId: string;
  readonly repoRoot: string;
};

export type TicketWorkflowTicketDetails = {
  readonly ticketId: string;
  readonly title: string;
  readonly acceptanceCriteria: string;
  readonly comments: readonly string[];
};

export type UpdateMainInput = {
  readonly repoRoot: string;
};

export type AssertCleanMainInput = {
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

export type SyncMainForPushInput = {
  readonly repoRoot: string;
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

export type ReadReadyTicketWorkflowQueueInput = {
  readonly repoRoot: string;
};

export type ReadVerifiedMergeQueueInput = {
  readonly repoRoot: string;
};

export type ReadStuckTicketRecoveryCandidatesInput = {
  readonly repoRoot: string;
};

export type StuckTicketRecoveryCandidate = {
  readonly ticketId: string;
  readonly title: string;
  readonly workflowId: string;
  readonly reason: string;
  readonly branch: string;
  readonly worktree: string;
  readonly tmuxSession: string;
  readonly stdoutLog: string;
  readonly stderrLog: string;
  readonly promptPath: string;
};

export type InspectTicketWorkflowExecutionInput = {
  readonly address: string;
  readonly namespace: string;
  readonly workflowId: string;
};

export type TicketWorkflowExecutionStatus =
  | { readonly status: "running"; readonly detail: string }
  | { readonly status: "missing"; readonly detail: string }
  | { readonly status: "closed"; readonly detail: string };

export type RecoverStuckTicketInput = {
  readonly repoRoot: string;
  readonly runtimeLogRoot: string;
  readonly candidate: StuckTicketRecoveryCandidate;
  readonly workflowStatus: Exclude<TicketWorkflowExecutionStatus["status"], "running">;
  readonly workflowStatusDetail: string;
};

export type StuckTicketRecoveryCleanupResult = {
  readonly action: TicketArtifactCleanupAction;
  readonly ok: boolean;
  readonly record: ActivityRecord;
};

export type RecoverStuckTicketResult = {
  readonly ticketId: string;
  readonly ok: boolean;
  readonly plan: TicketArtifactCleanupPlan;
  readonly cleanup: readonly StuckTicketRecoveryCleanupResult[];
  readonly records: readonly ActivityRecord[];
};

export type ReadyTicketWorkflowQueueTicket = {
  readonly ticketId: string;
  readonly title: string;
  readonly acceptanceCriteria: string;
  readonly comments: readonly string[];
};

export type VerifiedMergeQueueTicket = ReadyTicketWorkflowQueueTicket & {
  readonly branch: string;
  readonly commitSha: string | null;
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

export type PrepareTicketWorktreeInput = {
  readonly worktreePath: string;
};

export type ValidateTicketImplementationInput = {
  readonly worktreePath: string;
  readonly gates: readonly FinalGateCommand[];
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
  readonly builderHandoff?: TicketBeadsInput;
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

export async function prepareTicketWorktreeActivity(
  input: PrepareTicketWorktreeInput,
): Promise<MergeActivityResult> {
  return prepareTicketWorktree(input, runCommand);
}

export async function validateTicketImplementationActivity(
  input: ValidateTicketImplementationInput,
): Promise<MergeActivityResult> {
  return validateTicketImplementation(input, runCommand);
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

export async function assertCleanMainActivity(
  input: AssertCleanMainInput,
): Promise<MergeActivityResult> {
  return assertCleanMain(input, runCommand);
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

export async function syncMainForPushActivity(
  input: SyncMainForPushInput,
): Promise<MergeActivityResult> {
  return syncMainForPush(input, runCommand);
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

export async function captureOpenCodeUsageActivity(
  input: CaptureOpenCodeUsageInput,
): Promise<CaptureOpenCodeUsageResult> {
  return captureOpenCodeUsageActivitySafe(input, runCommand);
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

export async function loadTicketWorkflowConfigActivity(): Promise<TicketWorkflowRuntimeConfig> {
  return loadTicketWorkflowConfig();
}

export async function loadTicketWorkflowTicketDetailsActivity(
  input: TicketWorkflowTicketDetailsInput,
): Promise<TicketWorkflowTicketDetails> {
  return loadTicketWorkflowTicketDetails(input, runCommand);
}

export async function readReadyTicketWorkflowQueueActivity(
  input: ReadReadyTicketWorkflowQueueInput,
): Promise<ReadyTicketWorkflowQueueTicket[]> {
  return readReadyTicketWorkflowQueue(input, runCommand);
}

export async function readVerifiedMergeQueueActivity(
  input: ReadVerifiedMergeQueueInput,
): Promise<VerifiedMergeQueueTicket[]> {
  return readVerifiedMergeQueue(input, runCommand);
}

export async function readStuckTicketRecoveryCandidatesActivity(
  input: ReadStuckTicketRecoveryCandidatesInput,
): Promise<StuckTicketRecoveryCandidate[]> {
  return readStuckTicketRecoveryCandidates(input, runCommand);
}

export async function inspectTicketWorkflowExecutionActivity(
  input: InspectTicketWorkflowExecutionInput,
): Promise<TicketWorkflowExecutionStatus> {
  return inspectTicketWorkflowExecution(input);
}

export async function recoverStuckTicketActivity(
  input: RecoverStuckTicketInput,
): Promise<RecoverStuckTicketResult> {
  return recoverStuckTicket(input, runCommand, readDirectoryNames);
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

export async function requeueTicketActivity(input: TicketBeadsInput): Promise<MergeActivityResult> {
  return requeueTicket(input, runCommand);
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
  const baseRef = input.baseRef ?? "HEAD";
  const records: ActivityRecord[] = [];

  if (baseRef === "origin/main") {
    records.push(
      await runRecorded("refresh-origin-main", run, {
        command: "git",
        args: ["fetch", "origin", "main:refs/remotes/origin/main"],
        cwd: input.repoRoot,
      }),
    );
  }

  records.push(
    await runRecorded("create-worktree-parent", run, {
      command: "mkdir",
      args: ["-p", dirname(names.worktreePath)],
      cwd: input.repoRoot,
    }),
    await runRecorded("remove-existing-worktree", run, {
      command: "sh",
      args: [
        "-c",
        'git -C "$1" worktree remove --force "$2" 2>/dev/null || true',
        "sh",
        input.repoRoot,
        names.worktreePath,
      ],
    }),
    await runRecorded("remove-existing-branch", run, {
      command: "sh",
      args: [
        "-c",
        'git -C "$1" branch -D "$2" 2>/dev/null || true',
        "sh",
        input.repoRoot,
        names.branchName,
      ],
    }),
    await runRecorded("create-worktree", run, {
      command: "git",
      args: ["worktree", "add", "-b", names.branchName, names.worktreePath, baseRef],
      cwd: input.repoRoot,
    }),
  );

  return { ...names, records };
}

export async function prepareTicketWorktree(
  input: PrepareTicketWorktreeInput,
  run: ActivityCommandRunner,
): Promise<MergeActivityResult> {
  return runMergeCommands(run, [
    {
      activity: "install-dependencies",
      command: {
        command: "bun",
        args: ["install", "--frozen-lockfile"],
        cwd: input.worktreePath,
      },
    },
  ]);
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
    if (input.builderHandoff) {
      const handoff = await verifyBuilderHandoff(input.builderHandoff, run);
      records.push(...handoff.records);
      if (handoff.ok) {
        const kill = await run({
          command: "tmux",
          args: ["kill-session", "-t", `=${input.sessionName}`],
        });
        records.push(
          commandRecord(
            "kill-builder-session-after-handoff",
            { command: "tmux", args: ["kill-session", "-t", `=${input.sessionName}`] },
            kill,
          ),
        );
        return {
          sessionName: input.sessionName,
          completed: kill.exitCode === 0,
          exitCode: kill.exitCode === 0 ? 0 : null,
          stdout: await readLogFile(input.stdoutLogPath, run),
          stderr: await readLogFile(input.stderrLogPath, run),
          records,
        };
      }
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

export async function assertCleanMain(
  input: AssertCleanMainInput,
  run: ActivityCommandRunner,
): Promise<MergeActivityResult> {
  const result = await run({
    command: "git",
    args: ["status", "--porcelain"],
    cwd: input.repoRoot,
  });
  const record = commandRecord(
    "assert-clean-main",
    { command: "git", args: ["status", "--porcelain"], cwd: input.repoRoot },
    result,
  );
  return { ok: result.exitCode === 0 && result.stdout.trim().length === 0, records: [record] };
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

export async function syncMainForPush(
  input: SyncMainForPushInput,
  run: ActivityCommandRunner,
): Promise<MergeActivityResult> {
  const records: ActivityRecord[] = [];
  const fetch = await run({
    command: "git",
    args: ["fetch", "origin", "main"],
    cwd: input.repoRoot,
  });
  records.push(
    commandRecord(
      "sync-main-for-push:fetch",
      { command: "git", args: ["fetch", "origin", "main"], cwd: input.repoRoot },
      fetch,
    ),
  );
  if (fetch.exitCode !== 0) return { ok: false, records };

  const containsRemote = await run({
    command: "git",
    args: ["merge-base", "--is-ancestor", "origin/main", "HEAD"],
    cwd: input.repoRoot,
  });
  records.push(
    commandRecord(
      "sync-main-for-push:contains-remote",
      {
        command: "git",
        args: ["merge-base", "--is-ancestor", "origin/main", "HEAD"],
        cwd: input.repoRoot,
      },
      containsRemote,
    ),
  );
  if (containsRemote.exitCode === 0) return { ok: true, records };
  if (containsRemote.exitCode !== 1) return { ok: false, records };

  const rebase = await run({
    command: "git",
    args: ["rebase", "origin/main"],
    cwd: input.repoRoot,
  });
  records.push(
    commandRecord(
      "sync-main-for-push:rebase",
      { command: "git", args: ["rebase", "origin/main"], cwd: input.repoRoot },
      rebase,
    ),
  );
  return { ok: rebase.exitCode === 0, records };
}

export async function validateTicketImplementation(
  input: ValidateTicketImplementationInput,
  run: ActivityCommandRunner,
): Promise<MergeActivityResult> {
  const records: ActivityRecord[] = [];
  const format = await runRecorded("format", run, {
    command: "bun",
    args: ["run", "format"],
    cwd: input.worktreePath,
  });
  records.push(format);
  if (format.exitCode !== 0) return { ok: false, records };

  const cleanAfterFormat = await runRecorded("assert-clean-after-format", run, {
    command: "git",
    args: ["status", "--porcelain"],
    cwd: input.worktreePath,
  });
  records.push(cleanAfterFormat);
  if (cleanAfterFormat.exitCode !== 0 || cleanAfterFormat.stdout.trim().length > 0) {
    return { ok: false, records };
  }

  const gates = await runFinalGates(
    {
      repoRoot: input.worktreePath,
      gates: input.gates,
    },
    run,
  );
  records.push(...gates.records);
  if (!gates.ok) return { ok: false, records };

  const cleanAfterGates = await runRecorded("assert-clean-after-gates", run, {
    command: "git",
    args: ["status", "--porcelain"],
    cwd: input.worktreePath,
  });
  records.push(cleanAfterGates);
  return {
    ok: cleanAfterGates.exitCode === 0 && cleanAfterGates.stdout.trim().length === 0,
    records,
  };
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
      activity: "mark-ticket-shipped",
      command: {
        command: "bd",
        args: [
          "update",
          input.ticketId,
          "--set-metadata",
          `${TICKET_METADATA_KEYS.phase}=shipped`,
          "--set-metadata",
          `${TICKET_METADATA_KEYS.lastResult}=shipped`,
          ...lifecycleTransitionLabelArgs(null),
        ],
        cwd: input.repoRoot,
      },
    },
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

export function loadTicketWorkflowConfig(): TicketWorkflowRuntimeConfig {
  return {
    repoRoot: Bun.env.REPO_ROOT ?? new URL("../../..", import.meta.url).pathname,
    finalGates: [{ label: "gate", command: "bun", args: ["run", "gate"] }],
    runtimeLogRoot: Bun.env.TICKET_WORKFLOW_RUNTIME_LOG_ROOT ?? defaultRuntimeLogRoot(),
    baseRef: Bun.env.TICKET_WORKFLOW_BASE_REF ?? "HEAD",
    requirePushedBranch: envBoolean(Bun.env.TICKET_WORKFLOW_REQUIRE_PUSHED_BRANCH, true),
    mergeStrategy: envMergeStrategy(Bun.env.TICKET_WORKFLOW_MERGE_STRATEGY),
    ticketQueuePollIntervalMs: envInteger(Bun.env.TICKET_QUEUE_POLL_INTERVAL_MS, 15_000),
    maxActiveTicketWorkflows: envInteger(Bun.env.TICKET_QUEUE_MAX_ACTIVE, 3),
    maxTicketsPerPoll: envInteger(Bun.env.TICKET_QUEUE_MAX_PER_POLL, 3),
    maxMergeAttempts: envInteger(Bun.env.TICKET_MERGE_MAX_ATTEMPTS, 3),
    maxMergeHistoryEvents: envInteger(Bun.env.TICKET_MERGE_MAX_HISTORY_EVENTS, 100),
    stuckTicketRecoveryPollIntervalMs: envInteger(
      Bun.env.STUCK_TICKET_RECOVERY_POLL_INTERVAL_MS,
      60_000,
    ),
    stuckTicketRecoveryMaxTicketsPerPoll: envInteger(
      Bun.env.STUCK_TICKET_RECOVERY_MAX_PER_POLL,
      10,
    ),
    temporalAddress: Bun.env.TEMPORAL_ADDRESS ?? "127.0.0.1:7233",
    temporalNamespace: Bun.env.TEMPORAL_NAMESPACE ?? "project-management",
  };
}

export async function loadTicketWorkflowTicketDetails(
  input: TicketWorkflowTicketDetailsInput,
  run: ActivityCommandRunner,
): Promise<TicketWorkflowTicketDetails> {
  const adapter = beadsAdapter(input.repoRoot, run);
  const [ticket] = await adapter.showTickets([input.ticketId]);
  if (!ticket) {
    throw ApplicationFailure.create({
      message: `Ticket ${input.ticketId} was not found`,
      type: "TicketNotFound",
      nonRetryable: true,
    });
  }
  return {
    ticketId: ticket.id,
    title: ticket.title,
    acceptanceCriteria: ticket.acceptanceCriteria || "No acceptance criteria provided.",
    comments: ticket.comments.map((comment) => comment.text),
  };
}

export async function readReadyTicketWorkflowQueue(
  input: ReadReadyTicketWorkflowQueueInput,
  run: ActivityCommandRunner,
): Promise<ReadyTicketWorkflowQueueTicket[]> {
  const adapter = beadsAdapter(input.repoRoot, run);
  const queued = await adapter.builderQueue();

  if (queued.length === 0) {
    throw ApplicationFailure.create({
      message: "No ticket-ready Beads tickets are ready to run",
      type: "NoReadyTicketWorkflows",
      nonRetryable: false,
    });
  }

  const detailsById = new Map(
    (await adapter.showTickets(queued.map((ticket) => ticket.id))).map((ticket) => [
      ticket.id,
      ticket,
    ]),
  );

  return queued.map((ticket) => {
    const details = detailsById.get(ticket.id);
    return {
      ticketId: ticket.id,
      title: ticket.title,
      acceptanceCriteria: details?.acceptanceCriteria ?? "No acceptance criteria provided.",
      comments: details?.comments.map((comment) => comment.text) ?? [],
    };
  });
}

export async function readVerifiedMergeQueue(
  input: ReadVerifiedMergeQueueInput,
  run: ActivityCommandRunner,
): Promise<VerifiedMergeQueueTicket[]> {
  const adapter = beadsAdapter(input.repoRoot, run);
  const verified = (await adapter.verifiedQueue()).filter(
    (ticket) => ticket.status === "open" && !ticket.labels.includes(TICKET_WORKFLOW_LABELS.human),
  );
  if (verified.length === 0) {
    throw ApplicationFailure.create({
      message: "No ticket-verified Beads tickets are ready to merge",
      type: "NoVerifiedMergeQueueTickets",
      nonRetryable: false,
    });
  }

  const details = await adapter.showTickets(verified.map((ticket) => ticket.id));
  const mergeCandidates = details.flatMap((ticket) => {
    if (ticket.status !== "open" || ticket.labels.includes(TICKET_WORKFLOW_LABELS.human)) return [];
    const metadata = parseTicketMetadata(ticket);
    if (!metadata.branch) return [];
    return [
      {
        ticketId: ticket.id,
        title: ticket.title,
        acceptanceCriteria: ticket.acceptanceCriteria || "No acceptance criteria provided.",
        comments: ticket.comments.map((comment) => comment.text),
        branch: metadata.branch,
        commitSha: metadata.commit || null,
      },
    ];
  });
  if (mergeCandidates.length === 0) {
    throw ApplicationFailure.create({
      message: "No ticket-verified Beads tickets have merge metadata",
      type: "NoVerifiedMergeQueueTickets",
      nonRetryable: false,
    });
  }

  return mergeCandidates;
}

export async function readStuckTicketRecoveryCandidates(
  input: ReadStuckTicketRecoveryCandidatesInput,
  run: ActivityCommandRunner,
): Promise<StuckTicketRecoveryCandidate[]> {
  const listRecord = await run({
    command: "bd",
    args: ["list", "--json", "--no-pager", "-n", "0", "--status", "open"],
    cwd: input.repoRoot,
  });
  if (listRecord.exitCode !== 0) {
    throw ApplicationFailure.create({
      message: listRecord.stderr.trim() || listRecord.stdout.trim() || "bd list failed",
      type: "BeadsCommandFailed",
      nonRetryable: true,
    });
  }

  const tickets = parseRecoveryTicketList(listRecord.stdout);
  if (tickets.length === 0) {
    throw ApplicationFailure.create({
      message: "No workflow-owned Beads tickets need stuck-ticket recovery",
      type: "NoStuckTicketRecoveryCandidates",
      nonRetryable: false,
    });
  }

  const adapter = beadsAdapter(input.repoRoot, run);

  const details = await adapter.showTickets(tickets.map((ticket) => ticket.id));
  const candidates = details.flatMap((ticket) => recoveryCandidateFromTicket(ticket));
  if (candidates.length === 0) {
    throw ApplicationFailure.create({
      message: "No workflow-owned Beads tickets need stuck-ticket recovery",
      type: "NoStuckTicketRecoveryCandidates",
      nonRetryable: false,
    });
  }

  return candidates;
}

export async function inspectTicketWorkflowExecution(
  input: InspectTicketWorkflowExecutionInput,
): Promise<TicketWorkflowExecutionStatus> {
  try {
    const connection = await Connection.connect({ address: input.address });
    const client = new Client({ connection, namespace: input.namespace });
    const description = await client.workflow.getHandle(input.workflowId).describe();
    const rawStatus = String(
      description.status?.name ?? description.status ?? "unknown",
    ).toLowerCase();
    if (rawStatus.includes("running")) return { status: "running", detail: rawStatus };
    return { status: "closed", detail: rawStatus };
  } catch (error) {
    if (isWorkflowNotFoundError(error)) {
      return { status: "missing", detail: error instanceof Error ? error.message : "not found" };
    }
    throw error;
  }
}

export async function recoverStuckTicket(
  input: RecoverStuckTicketInput,
  run: ActivityCommandRunner,
  readNames: (path: string) => Promise<readonly string[]>,
): Promise<RecoverStuckTicketResult> {
  const worktreePaths = parseWorktreePaths(
    (
      await run({
        command: "git",
        args: ["-C", input.repoRoot, "worktree", "list", "--porcelain"],
      })
    ).stdout,
  );
  const localBranches = parseLines(
    (
      await run({
        command: "git",
        args: ["-C", input.repoRoot, "branch", "--format=%(refname:short)"],
      })
    ).stdout,
  );
  const remoteBranches = parseLines(
    (
      await run({
        command: "git",
        args: ["-C", input.repoRoot, "branch", "-r", "--format=%(refname:short)"],
      })
    ).stdout,
  );
  const tmuxSessions = parseLines(
    (
      await run({
        command: "tmux",
        args: ["list-sessions", "-F", "#S"],
      })
    ).stdout,
  );
  const evidenceFileNames = await readNames(input.runtimeLogRoot);
  const plan = planTicketArtifactCleanup({
    ticketId: input.candidate.ticketId,
    repoRoot: input.repoRoot,
    runtimeLogRoot: input.runtimeLogRoot,
    worktreePaths,
    localBranches,
    remoteBranches,
    tmuxSessions,
    evidenceFileNames,
    branchName: input.candidate.branch,
    killTmuxSessions: true,
    removeBranches: true,
  });

  const cleanup: StuckTicketRecoveryCleanupResult[] = [];
  const records: ActivityRecord[] = [];
  for (const action of plan.actions) {
    const record = await runCleanupAction(action, input.repoRoot, run);
    cleanup.push({ action, ok: record.exitCode === 0, record });
    records.push(record);
  }

  const cleanupSucceeded = cleanup.every((result) => result.ok);
  const recoveredAt = new Date().toISOString();
  const metadataRecord = await runRecordedCommand(
    cleanupSucceeded ? "mark-ticket-recovered" : "mark-ticket-recovery-failed",
    run,
    cleanupSucceeded
      ? recoveredTicketCommand(input, recoveredAt, cleanup)
      : failedRecoveryCommand(input, recoveredAt, cleanup),
  );
  records.push(metadataRecord);

  const commentRecord = await runRecordedCommand("comment-ticket-recovery", run, {
    command: "bd",
    args: ["comment", input.candidate.ticketId, "--stdin"],
    cwd: input.repoRoot,
    stdin: recoveryComment(input, plan, cleanup),
  });
  records.push(commentRecord);

  return {
    ticketId: input.candidate.ticketId,
    ok: cleanupSucceeded && metadataRecord.exitCode === 0 && commentRecord.exitCode === 0,
    plan,
    cleanup,
    records,
  };
}

function recoveredTicketCommand(
  input: RecoverStuckTicketInput,
  recoveredAt: string,
  cleanup: readonly StuckTicketRecoveryCleanupResult[],
): ActivityCommand {
  return {
    command: "bd",
    args: [
      "update",
      input.candidate.ticketId,
      "--add-label",
      TICKET_WORKFLOW_LABELS.ready,
      "--add-label",
      TICKET_WORKFLOW_LABELS.retry,
      "--remove-label",
      TICKET_WORKFLOW_LABELS.queued,
      "--remove-label",
      TICKET_WORKFLOW_LABELS.review,
      "--remove-label",
      TICKET_WORKFLOW_LABELS.verified,
      "--remove-label",
      TICKET_WORKFLOW_LABELS.human,
      "--set-metadata",
      `${TICKET_METADATA_KEYS.phase}=recovered`,
      "--set-metadata",
      `${TICKET_METADATA_KEYS.lastResult}=recovered-${input.workflowStatus}`,
      "--set-metadata",
      `ticket_recovered_at=${recoveredAt}`,
      "--set-metadata",
      `ticket_recovery_reason=${input.workflowStatusDetail}`,
      "--set-metadata",
      `ticket_recovery_cleanup=${cleanupSummary(cleanup)}`,
    ],
    cwd: input.repoRoot,
  };
}

function failedRecoveryCommand(
  input: RecoverStuckTicketInput,
  recoveredAt: string,
  cleanup: readonly StuckTicketRecoveryCleanupResult[],
): ActivityCommand {
  return {
    command: "bd",
    args: [
      "update",
      input.candidate.ticketId,
      "--add-label",
      TICKET_WORKFLOW_LABELS.human,
      "--set-metadata",
      `${TICKET_METADATA_KEYS.phase}=recovery-failed`,
      "--set-metadata",
      `${TICKET_METADATA_KEYS.lastResult}=recovery-cleanup-failed`,
      "--set-metadata",
      `ticket_recovered_at=${recoveredAt}`,
      "--set-metadata",
      `ticket_recovery_reason=${input.workflowStatusDetail}`,
      "--set-metadata",
      `ticket_recovery_cleanup=${cleanupSummary(cleanup)}`,
    ],
    cwd: input.repoRoot,
  };
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
          ...lifecycleTransitionLabelArgs(TICKET_WORKFLOW_LABELS.review),
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
          ...lifecycleTransitionLabelArgs(TICKET_WORKFLOW_LABELS.verified),
        ],
        cwd: input.repoRoot,
      },
    },
  ]);
}

export async function requeueTicket(
  input: TicketBeadsInput,
  run: ActivityCommandRunner,
): Promise<MergeActivityResult> {
  const command = buildFailedReviewRequeueCommand(input.ticketId);
  return runMergeCommands(run, [
    {
      activity: "requeue-ticket",
      command: {
        command: command.command,
        args: command.args,
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
  const handoff = hasBuilderComment ? "review" : "missing";

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
          ...lifecycleTransitionLabelArgs(TICKET_WORKFLOW_LABELS.human),
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

function parseTicketMetadata(ticket: unknown): {
  readonly branch: string;
  readonly commit: string;
} {
  if (!ticket || typeof ticket !== "object") return { branch: "", commit: "" };
  const candidate = ticket as Record<string, unknown>;
  const metadata =
    candidate.metadata && typeof candidate.metadata === "object"
      ? (candidate.metadata as Record<string, unknown>)
      : candidate;
  return {
    branch: stringField(metadata, TICKET_METADATA_KEYS.branch),
    commit: stringField(metadata, TICKET_METADATA_KEYS.commit),
  };
}

function beadsAdapter(repoRoot: string, run: ActivityCommandRunner): BeadsAdapter {
  return new BeadsAdapter(async (command) => {
    const result = await run({
      command: command.command,
      args: command.args,
      cwd: repoRoot,
      stdin: command.stdin,
    });
    if (result.exitCode !== 0) {
      throw ApplicationFailure.create({
        message: result.stderr.trim() || result.stdout.trim() || "bd command failed",
        type: "BeadsCommandFailed",
        nonRetryable: true,
      });
    }
    return result.stdout;
  });
}

function envInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function envBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

function envMergeStrategy(value: string | undefined): "cherry-pick" | "merge" {
  return value === "cherry-pick" ? "cherry-pick" : "merge";
}

function parseRecoveryTicketList(stdout: string): BeadsTicket[] {
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((ticket) => {
    if (!ticket || typeof ticket !== "object") return [];
    const candidate = ticket as Record<string, unknown>;
    const labels = parseStringArray(candidate.labels);
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.title !== "string" ||
      typeof candidate.status !== "string"
    ) {
      return [];
    }
    return [{ id: candidate.id, title: candidate.title, status: candidate.status, labels }];
  });
}

function hasWorkflowOwnedState(ticket: BeadsTicket): boolean {
  const labels = new Set(ticket.labels);
  return (
    labels.has(TICKET_WORKFLOW_LABELS.queued) ||
    labels.has(TICKET_WORKFLOW_LABELS.review) ||
    labels.has(TICKET_WORKFLOW_LABELS.verified) ||
    labels.has(TICKET_WORKFLOW_LABELS.human)
  );
}

function recoveryCandidateFromTicket(ticket: BeadsTicketDetails): StuckTicketRecoveryCandidate[] {
  if (ticket.status !== "open") return [];
  const labels = new Set(ticket.labels);
  if (labels.has(TICKET_WORKFLOW_LABELS.backlog)) return [];
  const metadata = ticket.metadata ?? {};
  const branch = stringField(metadata, TICKET_METADATA_KEYS.branch);
  const worktree = stringField(metadata, TICKET_METADATA_KEYS.worktree);
  const tmuxSession = stringField(metadata, TICKET_METADATA_KEYS.tmuxSession);
  const phase = stringField(metadata, TICKET_METADATA_KEYS.phase);
  if (!hasWorkflowOwnedState(ticket) && phase.length === 0) return [];
  return [
    {
      ticketId: ticket.id,
      title: ticket.title,
      workflowId: `ticket_${ticket.id}`,
      reason: phase ? `ticket phase is ${phase}` : "ticket has workflow-owned label",
      branch,
      worktree,
      tmuxSession,
      promptPath: stringField(metadata, TICKET_METADATA_KEYS.promptPath),
      stdoutLog: stringField(metadata, TICKET_METADATA_KEYS.stdoutLog),
      stderrLog: stringField(metadata, TICKET_METADATA_KEYS.stderrLog),
    },
  ];
}

function isWorkflowNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const text = `${error.name} ${error.message}`.toLowerCase();
  return text.includes("not found") || text.includes("not_found") || text.includes("notfound");
}

function parseWorktreePaths(output: string): string[] {
  return output
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
}

function parseLines(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function readDirectoryNames(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function runCleanupAction(
  action: TicketArtifactCleanupAction,
  repoRoot: string,
  run: ActivityCommandRunner,
): Promise<ActivityRecord> {
  switch (action.kind) {
    case "remove-worktree":
      return runRecordedCommand("cleanup-remove-worktree", run, {
        command: "git",
        args: ["-C", repoRoot, "worktree", "remove", action.path],
      });
    case "remove-local-branch":
      return runRecordedCommand("cleanup-remove-local-branch", run, {
        command: "git",
        args: ["-C", repoRoot, "branch", "-D", action.branch],
      });
    case "remove-remote-branch":
      return runRecordedCommand("cleanup-remove-remote-branch", run, {
        command: "git",
        args: ["-C", repoRoot, "push", action.remote, "--delete", action.branch],
      });
    case "kill-tmux-session":
      return runRecordedCommand("cleanup-kill-tmux-session", run, {
        command: "tmux",
        args: ["kill-session", "-t", `=${action.sessionName}`],
      });
    case "remove-evidence":
      return runRecordedCommand("cleanup-remove-evidence", run, {
        command: "rm",
        args: ["-f", action.path],
      });
  }
}

async function runRecordedCommand(
  activity: string,
  run: ActivityCommandRunner,
  command: ActivityCommand,
): Promise<ActivityRecord> {
  return commandRecord(activity, command, await run(command));
}

function cleanupSummary(cleanup: readonly StuckTicketRecoveryCleanupResult[]): string {
  const passed = cleanup.filter((result) => result.ok).length;
  return `${passed}/${cleanup.length} cleanup actions succeeded`;
}

function recoveryComment(
  input: RecoverStuckTicketInput,
  plan: TicketArtifactCleanupPlan,
  cleanup: readonly StuckTicketRecoveryCleanupResult[],
): string {
  const actionLines = cleanup.map(
    (result) => `- ${result.ok ? "ok" : "failed"}: ${formatCleanupAction(result.action)}`,
  );
  return [
    "## Recovery summary",
    "",
    `Recovered ${input.candidate.ticketId} because ${input.workflowStatusDetail}.`,
    `Workflow status: ${input.workflowStatus}.`,
    "",
    "Cleanup actions:",
    ...(actionLines.length > 0 ? actionLines : ["- none"]),
    "",
    "Preserved evidence:",
    ...(plan.preservedEvidencePaths.length > 0
      ? plan.preservedEvidencePaths.map((path) => `- ${path}`)
      : ["- none"]),
  ].join("\n");
}

function formatCleanupAction(action: TicketArtifactCleanupAction): string {
  switch (action.kind) {
    case "remove-worktree":
      return `worktree ${action.path}`;
    case "remove-local-branch":
      return `local branch ${action.branch}`;
    case "remove-remote-branch":
      return `remote branch ${action.remote}/${action.branch}`;
    case "kill-tmux-session":
      return `tmux session ${action.sessionName}`;
    case "remove-evidence":
      return `evidence ${action.path}`;
  }
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

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
