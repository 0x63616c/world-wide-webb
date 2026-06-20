import {
  condition,
  continueAsNew,
  defineQuery,
  defineSignal,
  getExternalWorkflowHandle,
  ParentClosePolicy,
  proxyActivities,
  setHandler,
  sleep,
  startChild,
} from "@temporalio/workflow";
import type { TicketWorkflowMetadata } from "../beads-adapter";
import type * as projectActivities from "./activities";
import type * as agentActivities from "./agent-activities";
import type * as commandActivities from "./command-activities";
import {
  applyTicketWorkflowEvents,
  type IssueTransitionInput,
  type IssueTransitionResult,
  initialTicketWorkflowState,
  type TicketWorkflowEvent,
  type TicketWorkflowSignal,
  type TicketWorkflowState,
  transitionIssueState,
  transitionTicketWorkflow,
} from "./state";

export const MERGE_QUEUE_WORKFLOW_ID = "ticket_merge_queue";

const activities = proxyActivities<typeof projectActivities>({
  startToCloseTimeout: "1 minute",
});

const mergeActivityProxies = proxyActivities<MergeWorkflowActivities>({
  startToCloseTimeout: "10 minutes",
});

export async function issueTransitionWorkflow(
  input: IssueTransitionInput,
): Promise<IssueTransitionResult> {
  return transitionIssueState(input);
}

export async function projectSnapshotWorkflow(): Promise<projectActivities.ProjectSnapshot> {
  return activities.loadProjectSnapshot();
}

export type MergeWorkflowInput = {
  readonly ticketId: string;
  readonly title?: string;
  readonly repoRoot: string;
  readonly branch: string;
  readonly commitSha?: string;
  readonly strategy: "cherry-pick" | "merge";
  readonly finalGates: readonly commandActivities.FinalGateCommand[];
  readonly acceptanceCriteria?: string;
  readonly comments?: readonly string[];
  readonly maxMergeFixAttempts?: number;
  readonly runtimeLogRoot?: string;
};

export type MergeQueueWorkflowInput = {
  readonly repoRoot: string;
  readonly taskQueue: string;
  readonly finalGates: readonly commandActivities.FinalGateCommand[];
  readonly runtimeLogRoot?: string;
  readonly maxMergeAttempts?: number;
  readonly maxHistoryEvents?: number;
  readonly initialQueued?: readonly MergeQueueRequest[];
  readonly completedCount?: number;
};

export type MergeQueueRequest = {
  readonly requestId: string;
  readonly ticketId: string;
  readonly ticketWorkflowId: string;
  readonly title: string;
  readonly branch: string;
  readonly commitSha?: string | null;
  readonly strategy: "cherry-pick" | "merge";
  readonly acceptanceCriteria: string;
  readonly comments: readonly string[];
  readonly requestedAt: string;
  readonly runtimeLogRoot?: string;
};

export type MergeQueueStep =
  | "assert-clean-main"
  | "update-main"
  | "merge-ticket-branch"
  | "final-gates"
  | "push-main"
  | "close-ticket"
  | "push-beads";

export const MERGE_QUEUE_STEPS = [
  "assert-clean-main",
  "update-main",
  "merge-ticket-branch",
  "final-gates",
  "push-main",
  "close-ticket",
  "push-beads",
] as const satisfies readonly MergeQueueStep[];

export type MergeQueueResult =
  | {
      readonly status: "merged";
      readonly ticketId: string;
      readonly requestId: string;
      readonly mergeCommitSha: string | null;
      readonly pushed: true;
      readonly closed: true;
    }
  | {
      readonly status: "retryable-failure";
      readonly ticketId: string;
      readonly requestId: string;
      readonly failedStep: MergeQueueStep;
      readonly attempt: number;
      readonly reason: string;
    }
  | {
      readonly status: "human-blocked";
      readonly ticketId: string;
      readonly requestId: string;
      readonly failedStep: MergeQueueStep;
      readonly reason: string;
    };

export type MergeQueueEntry = {
  readonly request: MergeQueueRequest;
  readonly enqueuedAt: string;
};

export type MergeQueueSnapshot = {
  readonly queued: readonly MergeQueueEntry[];
  readonly active: MergeQueueEntry | null;
  readonly completedCount: number;
};

export type MergeQueueMutableState = {
  readonly queued: MergeQueueEntry[];
  active: MergeQueueEntry | null;
  completedCount: number;
  readonly completed: Map<string, MergeQueueResult>;
};

export type MergeWorkflowStep =
  | "assert-clean-main"
  | "update-main"
  | "merge-ticket-branch"
  | "merge-fix"
  | "final-gates"
  | "push-main"
  | "close-ticket"
  | "push-beads"
  | "escalate-human";

export type MergeWorkflowStepResult = {
  readonly step: MergeWorkflowStep;
  readonly ok: boolean;
  readonly records: readonly commandActivities.ActivityRecord[];
};

export type MergeWorkflowResult = {
  readonly ticketId: string;
  readonly status: "merged" | "failed";
  readonly failedStep: MergeWorkflowStep | null;
  readonly pushed: boolean;
  readonly closed: boolean;
  readonly humanEscalated: boolean;
  readonly steps: readonly MergeWorkflowStepResult[];
};

export type MergeWorkflowQueueInput = {
  readonly tickets: readonly MergeWorkflowInput[];
};

export type MergeWorkflowQueueResult = {
  readonly status: "merged" | "failed";
  readonly failedTicketId: string | null;
  readonly results: readonly MergeWorkflowResult[];
};

export type TicketWorkflowRunnerInput = {
  readonly ticketId: string;
  readonly title: string;
  readonly repoRoot: string;
  readonly acceptanceCriteria: string;
  readonly comments?: readonly string[];
  readonly finalGates: readonly commandActivities.FinalGateCommand[];
  readonly runtimeLogRoot?: string;
  readonly baseRef?: string;
  readonly requirePushedBranch?: boolean;
  readonly mergeStrategy?: "cherry-pick" | "merge";
};

export type TicketMergeQueueClient = {
  readonly enqueueAndWait: (request: MergeQueueRequest) => Promise<MergeQueueResult>;
};

export type TicketWorkflowRunnerStep =
  | "claim-ticket"
  | "create-worktree"
  | "start-builder"
  | "write-builder-start-metadata"
  | "wait-builder"
  | "resolve-commit"
  | "resolve-builder-session"
  | "write-builder-completion-metadata"
  | "verify-builder-handoff"
  | "start-reviewer"
  | "write-reviewer-start-metadata"
  | "wait-reviewer"
  | "resolve-reviewer-session"
  | "write-reviewer-completion-metadata"
  | "verify-reviewer-handoff"
  | "retry-requested"
  | "human-handoff"
  | "merge";

export type TicketWorkflowRunnerStepResult = {
  readonly step: TicketWorkflowRunnerStep;
  readonly ok: boolean;
};

export type TicketWorkflowRunnerResult = {
  readonly ticketId: string;
  readonly status: "merged" | "failed" | "human";
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly commitSha: string | null;
  readonly builderSessionName: string | null;
  readonly reviewerSessionName: string | null;
  readonly mergeResult: MergeWorkflowResult | null;
  readonly steps: readonly TicketWorkflowRunnerStepResult[];
};

export type MergeWorkflowActivities = Pick<
  typeof commandActivities,
  | "updateMainActivity"
  | "mergeTicketBranchActivity"
  | "runFinalGatesActivity"
  | "pushMainActivity"
  | "closeTicketActivity"
  | "pushBeadsActivity"
  | "escalateTicketHumanActivity"
> &
  Pick<typeof agentActivities, "startTicketMergeFixActivity">;

export type MergeQueueActivities = MergeWorkflowActivities &
  Pick<
    typeof commandActivities,
    "assertCleanMainActivity" | "readVerifiedMergeQueueActivity" | "resolveGitHeadActivity"
  >;

export type TicketWorkflowRunnerActivities = Pick<
  typeof commandActivities,
  | "claimTicketActivity"
  | "createTicketWorktreeActivity"
  | "waitForAgentRunCompletionActivity"
  | "resolveGitHeadActivity"
  | "resolveOpenCodeSessionActivity"
  | "writeTicketWorkflowMetadataActivity"
  | "verifyBuilderHandoffActivity"
  | "verifyReviewerHandoffActivity"
> &
  Pick<typeof agentActivities, "startTicketBuilderActivity" | "startTicketReviewerActivity"> &
  MergeWorkflowActivities;

const ticketWorkflowRunnerActivityProxies = proxyActivities<TicketWorkflowRunnerActivities>({
  startToCloseTimeout: "10 minutes",
});

const mergeQueueActivityProxies = proxyActivities<MergeQueueActivities>({
  startToCloseTimeout: "10 minutes",
});

export type TicketQueueWorkflowInput = {
  readonly repoRoot: string;
  readonly finalGates: readonly commandActivities.FinalGateCommand[];
  readonly runtimeLogRoot?: string;
  readonly baseRef?: string;
  readonly requirePushedBranch?: boolean;
  readonly mergeStrategy?: "cherry-pick" | "merge";
  readonly pollIntervalMs?: number;
  readonly maxTicketsPerPoll?: number;
  readonly maxActiveTicketWorkflows?: number;
};

export type TicketQueueConfig = Pick<
  TicketQueueWorkflowInput,
  "maxActiveTicketWorkflows" | "maxTicketsPerPoll"
>;

export const DEFAULT_MAX_ACTIVE_TICKET_WORKFLOWS = 3;

export type TicketQueueWorkflowActivities = Pick<
  typeof commandActivities,
  "readReadyTicketWorkflowQueueActivity"
>;

export type TicketQueueWorkflowChildInput = {
  readonly ticketId: string;
  readonly input: TicketWorkflowInput;
};

export type TicketQueueWorkflowBatchResult = {
  readonly started: readonly string[];
  readonly skipped: readonly string[];
};

export type TicketChildWorkflowStarter = (
  child: TicketQueueWorkflowChildInput,
) => Promise<"started" | "skipped">;

const ticketQueueActivityProxies = proxyActivities<TicketQueueWorkflowActivities>({
  startToCloseTimeout: "1 minute",
  retry: {
    initialInterval: "15 seconds",
    maximumInterval: "15 seconds",
  },
});

const TICKET_RUNNER_MAX_BUILDER_ATTEMPTS = 2;
const TICKET_RUNNER_MAX_REVIEWER_ATTEMPTS = 2;

export async function mergeWorkflow(
  input: MergeWorkflowQueueInput,
): Promise<MergeWorkflowQueueResult> {
  return runSerializedMergeQueueWorkflow(input, mergeActivityProxies);
}

export const enqueueMergeSignal = defineSignal<[MergeQueueRequest]>("enqueueMerge");
export const cancelMergeSignal = defineSignal<[string, string]>("cancelMerge");
export const ticketMergeResultSignal = defineSignal<[MergeQueueResult]>("ticketMergeResult");
export const mergeQueueSnapshotQuery = defineQuery<MergeQueueSnapshot>("mergeQueueSnapshot");
export const updateTicketQueueConfigSignal =
  defineSignal<[TicketQueueConfig]>("updateTicketQueueConfig");

export async function mergeQueueWorkflow(input: MergeQueueWorkflowInput): Promise<never> {
  const state: MergeQueueMutableState = {
    queued: [...(input.initialQueued ?? [])].map((request) => ({
      request,
      enqueuedAt: request.requestedAt,
    })),
    active: null,
    completedCount: input.completedCount ?? 0,
    completed: new Map<string, MergeQueueResult>(),
  };

  setHandler(enqueueMergeSignal, (request) => {
    enqueueMergeQueueRequest(state, request);
  });
  setHandler(cancelMergeSignal, (ticketId) => {
    cancelMergeQueueRequest(state, ticketId);
  });
  setHandler(mergeQueueSnapshotQuery, () => mergeQueueSnapshot(state));

  for (const request of await readExistingVerifiedMergeRequests(input)) {
    enqueueMergeQueueRequest(state, request);
  }

  while (true) {
    await condition(() => state.queued.length > 0);
    await processNextMergeQueueEntry(
      input,
      state,
      mergeQueueActivityProxies,
      signalTicketMergeResult,
    );

    if (shouldContinueMergeQueueAsNew(state, input.maxHistoryEvents ?? 100)) {
      await continueAsNew<typeof mergeQueueWorkflow>({
        ...input,
        initialQueued: state.queued.map((entry) => entry.request),
        completedCount: 0,
      });
    }
  }
}

async function signalTicketMergeResult(
  ticketWorkflowId: string,
  result: MergeQueueResult,
): Promise<void> {
  await getExternalWorkflowHandle(ticketWorkflowId).signal(ticketMergeResultSignal, result);
}

export async function ticketQueueWorkflow(input: TicketQueueWorkflowInput): Promise<never> {
  const pollIntervalMs = input.pollIntervalMs ?? 15_000;
  let config: TicketQueueConfig = {
    maxActiveTicketWorkflows: input.maxActiveTicketWorkflows,
    maxTicketsPerPoll: input.maxTicketsPerPoll,
  };
  const activeTicketIds = new Set<string>();

  setHandler(updateTicketQueueConfigSignal, (nextConfig) => {
    config = { ...config, ...nextConfig };
  });

  while (true) {
    await condition(
      () => activeTicketIds.size < resolveMaxActiveTicketWorkflows({ ...input, ...config }),
    );
    const tickets = await ticketQueueActivityProxies.readReadyTicketWorkflowQueueActivity({
      repoRoot: input.repoRoot,
    });
    await runTicketQueueBatch(
      { ...input, ...config },
      tickets,
      (child) => startTrackedTicketChildWorkflow(child, activeTicketIds),
      activeTicketIds.size,
    );
    await sleep(pollIntervalMs);
  }
}

export async function runTicketQueueBatch(
  input: TicketQueueWorkflowInput,
  tickets: readonly commandActivities.ReadyTicketWorkflowQueueTicket[],
  start: TicketChildWorkflowStarter,
  activeTicketWorkflowCount = 0,
): Promise<TicketQueueWorkflowBatchResult> {
  const availableSlots = Math.max(
    0,
    resolveMaxActiveTicketWorkflows(input) - activeTicketWorkflowCount,
  );
  const selectedTickets = tickets.slice(
    0,
    Math.min(input.maxTicketsPerPoll ?? tickets.length, availableSlots),
  );
  const results = await Promise.all(
    selectedTickets.map(async (ticket) => {
      const child: TicketQueueWorkflowChildInput = {
        ticketId: ticket.ticketId,
        input: {
          ticketId: ticket.ticketId,
          runner: {
            title: ticket.title,
            repoRoot: input.repoRoot,
            acceptanceCriteria: ticket.acceptanceCriteria,
            comments: ticket.comments,
            finalGates: input.finalGates,
            runtimeLogRoot: input.runtimeLogRoot,
            baseRef: input.baseRef,
            requirePushedBranch: input.requirePushedBranch,
            mergeStrategy: input.mergeStrategy,
          },
        },
      };
      return { ticketId: ticket.ticketId, status: await start(child) };
    }),
  );

  return {
    started: results
      .filter((result) => result.status === "started")
      .map((result) => result.ticketId),
    skipped: results
      .filter((result) => result.status === "skipped")
      .map((result) => result.ticketId),
  };
}

function resolveMaxActiveTicketWorkflows(input: TicketQueueWorkflowInput): number {
  return Math.max(0, input.maxActiveTicketWorkflows ?? DEFAULT_MAX_ACTIVE_TICKET_WORKFLOWS);
}

async function startTrackedTicketChildWorkflow(
  child: TicketQueueWorkflowChildInput,
  activeTicketIds: Set<string>,
): Promise<"started" | "skipped"> {
  try {
    const handle = await startChild(ticketWorkflow, {
      workflowId: ticketWorkflowId(child.ticketId),
      args: [child.input],
      parentClosePolicy: ParentClosePolicy.ABANDON,
    });
    activeTicketIds.add(child.ticketId);
    void handle.result().finally(() => {
      activeTicketIds.delete(child.ticketId);
    });
    return "started";
  } catch {
    return "skipped";
  }
}

export async function runSerializedMergeQueueWorkflow(
  input: MergeWorkflowQueueInput,
  mergeActivities: MergeWorkflowActivities,
): Promise<MergeWorkflowQueueResult> {
  const results: MergeWorkflowResult[] = [];

  for (const ticket of input.tickets) {
    const result = await runSerializedMergeWorkflow(ticket, mergeActivities);
    results.push(result);
    if (result.status === "failed") {
      return { status: "failed", failedTicketId: result.ticketId, results };
    }
  }

  return { status: "merged", failedTicketId: null, results };
}

export async function processMergeQueueRequest(
  input: MergeQueueWorkflowInput,
  request: MergeQueueRequest,
  mergeActivities: MergeQueueActivities,
): Promise<MergeQueueResult> {
  const maxAttempts = Math.max(1, input.maxMergeAttempts ?? 3);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const assertClean = await mergeActivities.assertCleanMainActivity({ repoRoot: input.repoRoot });
    if (!assertClean.ok) {
      return humanBlocked(request, "assert-clean-main", "main has uncommitted local changes");
    }

    const updateMain = await mergeActivities.updateMainActivity({ repoRoot: input.repoRoot });
    if (!updateMain.ok)
      return humanBlocked(request, "update-main", activityFailureReason(updateMain));

    const mergeBranch = await mergeActivities.mergeTicketBranchActivity({
      repoRoot: input.repoRoot,
      branch: request.branch,
      commitSha: request.commitSha ?? undefined,
      strategy: request.strategy,
    });
    if (!mergeBranch.ok) {
      if (attempt < maxAttempts) {
        continue;
      }
      await mergeActivities.escalateTicketHumanActivity({
        ticketId: request.ticketId,
        repoRoot: input.repoRoot,
        reason: `Merge queue failed at merge-ticket-branch after ${maxAttempts} attempt(s).`,
      });
      return humanBlocked(request, "merge-ticket-branch", activityFailureReason(mergeBranch));
    }

    const finalGates = await mergeActivities.runFinalGatesActivity({
      repoRoot: input.repoRoot,
      gates: input.finalGates,
    });
    if (!finalGates.ok) {
      if (attempt < maxAttempts) {
        continue;
      }
      await mergeActivities.escalateTicketHumanActivity({
        ticketId: request.ticketId,
        repoRoot: input.repoRoot,
        reason: `Merge queue final gates failed after ${maxAttempts} attempt(s).`,
      });
      return humanBlocked(request, "final-gates", activityFailureReason(finalGates));
    }

    const pushMain = await mergeActivities.pushMainActivity({ repoRoot: input.repoRoot });
    if (!pushMain.ok) {
      if (attempt < maxAttempts) {
        continue;
      }
      return humanBlocked(request, "push-main", activityFailureReason(pushMain));
    }

    const closeTicket = await mergeActivities.closeTicketActivity({
      ticketId: request.ticketId,
      repoRoot: input.repoRoot,
    });
    if (!closeTicket.ok)
      return humanBlocked(request, "close-ticket", activityFailureReason(closeTicket));

    const pushBeads = await mergeActivities.pushBeadsActivity({ repoRoot: input.repoRoot });
    if (!pushBeads.ok) return humanBlocked(request, "push-beads", activityFailureReason(pushBeads));

    const head = await mergeActivities.resolveGitHeadActivity({
      repoRoot: input.repoRoot,
      ref: "HEAD",
    });
    return {
      status: "merged",
      ticketId: request.ticketId,
      requestId: request.requestId,
      mergeCommitSha: head.commitSha,
      pushed: true,
      closed: true,
    };
  }

  return humanBlocked(request, "push-main", "merge queue attempts exhausted");
}

export async function runSerializedMergeWorkflow(
  input: MergeWorkflowInput,
  mergeActivities: MergeWorkflowActivities,
): Promise<MergeWorkflowResult> {
  const steps: MergeWorkflowStepResult[] = [];

  const updateMain = await mergeActivities.updateMainActivity({ repoRoot: input.repoRoot });
  steps.push({ step: "update-main", ...updateMain });
  if (!updateMain.ok) return failedMerge(input.ticketId, "update-main", steps);

  const mergeBranch = await mergeActivities.mergeTicketBranchActivity({
    repoRoot: input.repoRoot,
    branch: input.branch,
    commitSha: input.commitSha,
    strategy: input.strategy,
  });
  steps.push({ step: "merge-ticket-branch", ...mergeBranch });
  if (!mergeBranch.ok) {
    return runMergeFixThenFinalGates(
      input,
      mergeActivities,
      steps,
      "merge-ticket-branch",
      mergeBranch.records,
    );
  }

  const finalGates = await mergeActivities.runFinalGatesActivity({
    repoRoot: input.repoRoot,
    gates: input.finalGates,
  });
  steps.push({ step: "final-gates", ...finalGates });
  if (!finalGates.ok) {
    return runMergeFixThenFinalGates(
      input,
      mergeActivities,
      steps,
      "final-gates",
      finalGates.records,
    );
  }

  const pushMain = await mergeActivities.pushMainActivity({ repoRoot: input.repoRoot });
  steps.push({ step: "push-main", ...pushMain });
  if (!pushMain.ok) return failedMerge(input.ticketId, "push-main", steps);

  const closeTicket = await mergeActivities.closeTicketActivity({
    ticketId: input.ticketId,
    repoRoot: input.repoRoot,
  });
  steps.push({ step: "close-ticket", ...closeTicket });
  if (!closeTicket.ok) return failedMerge(input.ticketId, "close-ticket", steps);

  const pushBeads = await mergeActivities.pushBeadsActivity({ repoRoot: input.repoRoot });
  steps.push({ step: "push-beads", ...pushBeads });
  if (!pushBeads.ok) return failedMerge(input.ticketId, "push-beads", steps);

  return {
    ticketId: input.ticketId,
    status: "merged",
    failedStep: null,
    pushed: true,
    closed: true,
    humanEscalated: false,
    steps,
  };
}

export async function runTicketWorkflowRunner(
  input: TicketWorkflowRunnerInput,
  runnerActivities: TicketWorkflowRunnerActivities,
  mergeQueue: TicketMergeQueueClient = inlineMergeQueueClient(input, runnerActivities),
): Promise<TicketWorkflowRunnerResult> {
  const steps: TicketWorkflowRunnerStepResult[] = [];
  const claim = await runnerActivities.claimTicketActivity({
    ticketId: input.ticketId,
    repoRoot: input.repoRoot,
  });
  steps.push({ step: "claim-ticket", ok: claim.ok });
  if (!claim.ok) return failedTicketWorkflowRunner(input.ticketId, steps);

  const worktree = await runnerActivities.createTicketWorktreeActivity({
    ticketId: input.ticketId,
    title: input.title,
    repoRoot: input.repoRoot,
    baseRef: input.baseRef,
  });
  steps.push({
    step: "create-worktree",
    ok: worktree.records.every((record) => record.exitCode === 0),
  });
  if (worktree.records.some((record) => record.exitCode !== 0)) {
    return failedTicketWorkflowRunner(input.ticketId, steps, worktree);
  }

  let builderSessionName: string | null = null;
  let reviewerSessionName: string | null = null;
  let builderOpenCodeSessionId: string | null = null;
  let reviewerOpenCodeSessionId: string | null = null;
  let commitSha: string | null = null;
  let comments = [...(input.comments ?? [])];

  for (
    let builderAttempt = 1;
    builderAttempt <= TICKET_RUNNER_MAX_BUILDER_ATTEMPTS;
    builderAttempt += 1
  ) {
    const builder = await runnerActivities.startTicketBuilderActivity({
      ticketId: input.ticketId,
      title: input.title,
      worktreePath: worktree.worktreePath,
      attempt: builderAttempt,
      acceptanceCriteria: input.acceptanceCriteria,
      comments,
      runtimeLogRoot: input.runtimeLogRoot,
      resumeSessionId: builderAttempt > 1 ? (builderOpenCodeSessionId ?? undefined) : undefined,
    });
    builderSessionName = builder.sessionName;
    steps.push({
      step: "start-builder",
      ok: builder.records.every((record) => record.exitCode === 0),
    });
    if (builder.records.some((record) => record.exitCode !== 0)) {
      continue;
    }

    const builderStartMetadata = await runnerActivities.writeTicketWorkflowMetadataActivity({
      ticketId: input.ticketId,
      repoRoot: input.repoRoot,
      metadata: ticketRunMetadata({
        phase: "build",
        attempt: builderAttempt,
        branch: worktree.branchName,
        worktreePath: worktree.worktreePath,
        run: builder,
        lastResult: "builder-started",
      }),
    });
    steps.push({ step: "write-builder-start-metadata", ok: builderStartMetadata.ok });
    if (!builderStartMetadata.ok) continue;

    const builderWait = await runnerActivities.waitForAgentRunCompletionActivity({
      sessionName: builder.sessionName,
      stdoutLogPath: builder.stdoutLogPath,
      stderrLogPath: builder.stderrLogPath,
      exitCodePath: builder.exitCodePath,
    });
    steps.push({ step: "wait-builder", ok: builderWait.completed && builderWait.exitCode === 0 });
    if (!builderWait.completed || builderWait.exitCode !== 0) {
      await runnerActivities.writeTicketWorkflowMetadataActivity({
        ticketId: input.ticketId,
        repoRoot: input.repoRoot,
        metadata: ticketRunMetadata({
          phase: "build",
          attempt: builderAttempt,
          branch: worktree.branchName,
          worktreePath: worktree.worktreePath,
          run: builder,
          lastResult: builderWait.completed ? "builder-failed" : "builder-timeout",
        }),
      });
      continue;
    }

    const builderOpenCodeSession = await runnerActivities.resolveOpenCodeSessionActivity({
      worktreePath: worktree.worktreePath,
      agent: "ticket-builder",
      startedAfterMs: builder.startedAtMs,
    });
    steps.push({ step: "resolve-builder-session", ok: builderOpenCodeSession.ok });
    if (builderOpenCodeSession.ok) builderOpenCodeSessionId = builderOpenCodeSession.sessionId;

    const head = await runnerActivities.resolveGitHeadActivity({
      repoRoot: worktree.worktreePath,
      ref: "HEAD",
    });
    steps.push({ step: "resolve-commit", ok: head.ok });
    commitSha = head.commitSha;

    const metadata = await runnerActivities.writeTicketWorkflowMetadataActivity({
      ticketId: input.ticketId,
      repoRoot: input.repoRoot,
      metadata: ticketRunMetadata({
        phase: "review",
        attempt: builderAttempt,
        branch: worktree.branchName,
        worktreePath: worktree.worktreePath,
        run: builder,
        openCodeSession: formatOpenCodeSession(
          builderOpenCodeSession.title,
          builderOpenCodeSession.sessionId,
        ),
        commit: head.commitSha ?? "",
        lastResult: "builder-passed",
      }),
    });
    steps.push({ step: "write-builder-completion-metadata", ok: metadata.ok });
    if (!head.ok || !head.commitSha) continue;

    const builderHandoff = await runnerActivities.verifyBuilderHandoffActivity({
      ticketId: input.ticketId,
      repoRoot: input.repoRoot,
    });
    steps.push({ step: "verify-builder-handoff", ok: builderHandoff.ok });
    if (!metadata.ok || !builderHandoff.ok) continue;
    comments = [...comments, agentOutput(builderWait)].filter(Boolean);

    for (
      let reviewerAttempt = 1;
      reviewerAttempt <= TICKET_RUNNER_MAX_REVIEWER_ATTEMPTS;
      reviewerAttempt += 1
    ) {
      const reviewer = await runnerActivities.startTicketReviewerActivity({
        ticketId: input.ticketId,
        title: input.title,
        branch: worktree.branchName,
        worktreePath: worktree.worktreePath,
        attempt: reviewerAttempt,
        acceptanceCriteria: input.acceptanceCriteria,
        comments,
        runtimeLogRoot: input.runtimeLogRoot,
        resumeSessionId: reviewerAttempt > 1 ? (reviewerOpenCodeSessionId ?? undefined) : undefined,
      });
      reviewerSessionName = reviewer.sessionName;
      steps.push({
        step: "start-reviewer",
        ok: reviewer.records.every((record) => record.exitCode === 0),
      });
      if (reviewer.records.some((record) => record.exitCode !== 0)) continue;

      const reviewerStartMetadata = await runnerActivities.writeTicketWorkflowMetadataActivity({
        ticketId: input.ticketId,
        repoRoot: input.repoRoot,
        metadata: ticketRunMetadata({
          phase: "review",
          attempt: reviewerAttempt,
          branch: worktree.branchName,
          worktreePath: worktree.worktreePath,
          run: reviewer,
          commit: head.commitSha,
          lastResult: "reviewer-started",
        }),
      });
      steps.push({ step: "write-reviewer-start-metadata", ok: reviewerStartMetadata.ok });
      if (!reviewerStartMetadata.ok) continue;

      const reviewerWait = await runnerActivities.waitForAgentRunCompletionActivity({
        sessionName: reviewer.sessionName,
        stdoutLogPath: reviewer.stdoutLogPath,
        stderrLogPath: reviewer.stderrLogPath,
        exitCodePath: reviewer.exitCodePath,
      });
      steps.push({
        step: "wait-reviewer",
        ok: reviewerWait.completed && reviewerWait.exitCode === 0,
      });
      if (!reviewerWait.completed || reviewerWait.exitCode !== 0) {
        await runnerActivities.writeTicketWorkflowMetadataActivity({
          ticketId: input.ticketId,
          repoRoot: input.repoRoot,
          metadata: ticketRunMetadata({
            phase: "review",
            attempt: reviewerAttempt,
            branch: worktree.branchName,
            worktreePath: worktree.worktreePath,
            run: reviewer,
            commit: head.commitSha,
            lastResult: reviewerWait.completed ? "reviewer-failed" : "reviewer-timeout",
          }),
        });
        continue;
      }

      const reviewerOpenCodeSession = await runnerActivities.resolveOpenCodeSessionActivity({
        worktreePath: worktree.worktreePath,
        agent: "ticket-reviewer",
        startedAfterMs: reviewer.startedAtMs,
      });
      steps.push({ step: "resolve-reviewer-session", ok: reviewerOpenCodeSession.ok });
      if (reviewerOpenCodeSession.ok) reviewerOpenCodeSessionId = reviewerOpenCodeSession.sessionId;

      const reviewerHandoff = await runnerActivities.verifyReviewerHandoffActivity({
        ticketId: input.ticketId,
        repoRoot: input.repoRoot,
      });
      steps.push({ step: "verify-reviewer-handoff", ok: reviewerHandoff.ok });
      comments = [...comments, agentOutput(reviewerWait)].filter(Boolean);
      const reviewerMetadata = await runnerActivities.writeTicketWorkflowMetadataActivity({
        ticketId: input.ticketId,
        repoRoot: input.repoRoot,
        metadata: ticketRunMetadata({
          phase: phaseFromReviewerHandoff(reviewerHandoff.handoff),
          attempt: reviewerAttempt,
          branch: worktree.branchName,
          worktreePath: worktree.worktreePath,
          run: reviewer,
          openCodeSession: formatOpenCodeSession(
            reviewerOpenCodeSession.title,
            reviewerOpenCodeSession.sessionId,
          ),
          commit: head.commitSha,
          lastResult: `reviewer-${reviewerHandoff.handoff}`,
        }),
      });
      steps.push({ step: "write-reviewer-completion-metadata", ok: reviewerMetadata.ok });
      if (!reviewerMetadata.ok) continue;
      if (reviewerHandoff.handoff === "human") {
        steps.push({ step: "human-handoff", ok: true });
        return humanTicketWorkflowRunner(
          input.ticketId,
          steps,
          worktree,
          head.commitSha,
          builder.sessionName,
          reviewer.sessionName,
        );
      }
      if (reviewerHandoff.handoff === "retry") {
        steps.push({ step: "retry-requested", ok: true });
        break;
      }
      if (reviewerHandoff.handoff !== "verified") continue;

      const mergeResult = await mergeQueue.enqueueAndWait({
        requestId: mergeQueueRequestId(input.ticketId, head.commitSha),
        ticketId: input.ticketId,
        ticketWorkflowId: ticketWorkflowId(input.ticketId),
        title: input.title,
        branch: worktree.branchName,
        commitSha: head.commitSha,
        strategy: input.mergeStrategy ?? "merge",
        acceptanceCriteria: input.acceptanceCriteria,
        comments,
        requestedAt: new Date(0).toISOString(),
        runtimeLogRoot: input.runtimeLogRoot,
      });
      steps.push({ step: "merge", ok: mergeResult.status === "merged" });

      return {
        ticketId: input.ticketId,
        status: ticketStatusFromMergeResult(mergeResult),
        branch: worktree.branchName,
        worktreePath: worktree.worktreePath,
        commitSha: head.commitSha,
        builderSessionName: builder.sessionName,
        reviewerSessionName: reviewer.sessionName,
        mergeResult: mergeWorkflowResultFromQueueResult(mergeResult),
        steps,
      };
    }
  }

  const escalation = await runnerActivities.escalateTicketHumanActivity({
    ticketId: input.ticketId,
    repoRoot: input.repoRoot,
    reason: `Ticket workflow exhausted ${TICKET_RUNNER_MAX_BUILDER_ATTEMPTS} builder attempt(s) or ${TICKET_RUNNER_MAX_REVIEWER_ATTEMPTS} reviewer attempt(s).`,
  });
  steps.push({ step: "human-handoff", ok: escalation.ok });
  if (escalation.ok && commitSha) {
    return humanTicketWorkflowRunner(
      input.ticketId,
      steps,
      worktree,
      commitSha,
      builderSessionName ?? "",
      reviewerSessionName ?? "",
    );
  }
  return failedTicketWorkflowRunner(
    input.ticketId,
    steps,
    worktree,
    builderSessionName,
    reviewerSessionName,
  );
}

async function runMergeFixThenFinalGates(
  input: MergeWorkflowInput,
  mergeActivities: MergeWorkflowActivities,
  steps: MergeWorkflowStepResult[],
  failedStep: "merge-ticket-branch" | "final-gates",
  failureRecords: readonly commandActivities.ActivityRecord[],
): Promise<MergeWorkflowResult> {
  const maxAttempts = Math.max(0, input.maxMergeFixAttempts ?? 1);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const mergeFix = await mergeActivities.startTicketMergeFixActivity({
      ticketId: input.ticketId,
      title: input.title ?? input.ticketId,
      repoRoot: input.repoRoot,
      branch: input.branch,
      attempt,
      failedStep,
      failureRecords,
      finalGates: input.finalGates,
      acceptanceCriteria: input.acceptanceCriteria ?? "No acceptance criteria provided.",
      comments: input.comments ?? [],
      runtimeLogRoot: input.runtimeLogRoot,
    });
    const mergeFixOk =
      mergeFix.records.length > 0 && mergeFix.records.every((record) => record.exitCode === 0);
    steps.push({ step: "merge-fix", ok: mergeFixOk, records: mergeFix.records });
    if (!mergeFixOk) continue;

    const finalGates = await mergeActivities.runFinalGatesActivity({
      repoRoot: input.repoRoot,
      gates: input.finalGates,
    });
    steps.push({ step: "final-gates", ...finalGates });
    if (finalGates.ok) return pushAndCloseMergedTicket(input, mergeActivities, steps);
  }

  const escalation = await mergeActivities.escalateTicketHumanActivity({
    ticketId: input.ticketId,
    repoRoot: input.repoRoot,
    reason: `Merge workflow failed at ${failedStep} after ${maxAttempts} merge-fix attempt(s).`,
  });
  steps.push({ step: "escalate-human", ...escalation });
  if (!escalation.ok) return failedMerge(input.ticketId, "escalate-human", steps, false);
  return failedMerge(input.ticketId, failedStep, steps, true);
}

async function pushAndCloseMergedTicket(
  input: MergeWorkflowInput,
  mergeActivities: MergeWorkflowActivities,
  steps: MergeWorkflowStepResult[],
): Promise<MergeWorkflowResult> {
  const pushMain = await mergeActivities.pushMainActivity({ repoRoot: input.repoRoot });
  steps.push({ step: "push-main", ...pushMain });
  if (!pushMain.ok) return failedMerge(input.ticketId, "push-main", steps);

  const closeTicket = await mergeActivities.closeTicketActivity({
    ticketId: input.ticketId,
    repoRoot: input.repoRoot,
  });
  steps.push({ step: "close-ticket", ...closeTicket });
  if (!closeTicket.ok) return failedMerge(input.ticketId, "close-ticket", steps);

  const pushBeads = await mergeActivities.pushBeadsActivity({ repoRoot: input.repoRoot });
  steps.push({ step: "push-beads", ...pushBeads });
  if (!pushBeads.ok) return failedMerge(input.ticketId, "push-beads", steps);

  return {
    ticketId: input.ticketId,
    status: "merged",
    failedStep: null,
    pushed: true,
    closed: true,
    humanEscalated: false,
    steps,
  };
}

export type TicketWorkflowInput = {
  readonly ticketId: string;
  readonly events?: readonly TicketWorkflowEvent[];
  readonly runner?: Omit<TicketWorkflowRunnerInput, "ticketId">;
};

export const ticketWorkflowStateQuery = defineQuery<TicketWorkflowState>("ticketWorkflowState");
export const pauseTicketWorkflowSignal = defineSignal("pauseTicketWorkflow");
export const resumeTicketWorkflowSignal = defineSignal("resumeTicketWorkflow");
export const retryTicketWorkflowSignal = defineSignal("retryTicketWorkflow");
export const markTicketHumanSignal = defineSignal<[string]>("markTicketHuman");
export const cancelTicketWorkflowSignal = defineSignal<[string]>("cancelTicketWorkflow");

export async function ticketWorkflow(input: TicketWorkflowInput): Promise<TicketWorkflowState> {
  let state = initialTicketWorkflowState(input.ticketId);

  setHandler(ticketWorkflowStateQuery, () => state);
  setHandler(pauseTicketWorkflowSignal, () => {
    state = applySignal(state, { type: "pause" });
  });
  setHandler(resumeTicketWorkflowSignal, () => {
    state = applySignal(state, { type: "resume" });
  });
  setHandler(retryTicketWorkflowSignal, () => {
    state = applySignal(state, { type: "retry" });
  });
  setHandler(markTicketHumanSignal, (reason) => {
    state = applySignal(state, { type: "mark-human", reason });
  });
  setHandler(cancelTicketWorkflowSignal, (reason) => {
    state = applySignal(state, { type: "cancel", reason });
  });

  state = applyTicketWorkflowEvents(input.ticketId, input.events ?? []);

  if (input.runner) {
    const result = await runTicketWorkflowRunner(
      { ticketId: input.ticketId, ...input.runner },
      ticketWorkflowRunnerActivityProxies,
      temporalMergeQueueClient(),
    );
    state = transitionTicketWorkflow(state, { type: "start-build" });
    state = transitionTicketWorkflow(state, {
      type: "complete-step",
      outcome: result.status === "merged" ? "merge-passed" : "merge-failed",
    });
  }

  return state;
}

function ticketWorkflowId(ticketId: string): string {
  return `ticket_${ticketId}`;
}

function temporalMergeQueueClient(): TicketMergeQueueClient {
  let result: MergeQueueResult | null = null;
  setHandler(ticketMergeResultSignal, (nextResult) => {
    result = nextResult;
  });
  return {
    enqueueAndWait: async (request) => {
      result = null;
      await getExternalWorkflowHandle(MERGE_QUEUE_WORKFLOW_ID).signal(enqueueMergeSignal, request);
      await condition(() => result !== null);
      if (result === null) throw new Error("ticket merge result was not delivered");
      return result;
    },
  };
}

function inlineMergeQueueClient(
  input: TicketWorkflowRunnerInput,
  runnerActivities: TicketWorkflowRunnerActivities,
): TicketMergeQueueClient {
  return {
    enqueueAndWait: async (request) => {
      const result = await runSerializedMergeWorkflow(
        {
          ticketId: request.ticketId,
          title: request.title,
          repoRoot: input.repoRoot,
          branch: request.branch,
          commitSha: request.commitSha ?? undefined,
          strategy: request.strategy,
          finalGates: input.finalGates,
          acceptanceCriteria: request.acceptanceCriteria,
          comments: request.comments,
          runtimeLogRoot: input.runtimeLogRoot,
        },
        runnerActivities,
      );
      if (result.status === "merged") {
        return {
          status: "merged",
          ticketId: request.ticketId,
          requestId: request.requestId,
          mergeCommitSha: null,
          pushed: true,
          closed: true,
        };
      }
      return humanBlocked(
        request,
        mergeQueueStepFromLegacy(result.failedStep),
        `Inline merge workflow failed at ${result.failedStep ?? "unknown"}`,
      );
    },
  };
}

export function enqueueMergeQueueRequest(
  state: MergeQueueMutableState,
  request: MergeQueueRequest,
): "queued" | "duplicate" {
  if (hasMergeQueueRequest(state, request)) return "duplicate";
  state.queued.push({ request, enqueuedAt: request.requestedAt });
  return "queued";
}

export function cancelMergeQueueRequest(
  state: MergeQueueMutableState,
  ticketId: string,
): "cancelled" | "missing" {
  const index = state.queued.findIndex((entry) => entry.request.ticketId === ticketId);
  if (index < 0) return "missing";
  state.queued.splice(index, 1);
  return "cancelled";
}

export function recordMergeQueueResult(
  state: MergeQueueMutableState,
  request: MergeQueueRequest,
  result: MergeQueueResult,
): void {
  state.completed.set(request.requestId, result);
  state.completed.set(request.ticketId, result);
  state.completedCount += 1;
}

export function mergeQueueSnapshot(state: MergeQueueMutableState): MergeQueueSnapshot {
  return {
    queued: state.queued,
    active: state.active,
    completedCount: state.completedCount,
  };
}

export function shouldContinueMergeQueueAsNew(
  state: MergeQueueMutableState,
  maxHistoryEvents: number,
): boolean {
  return state.completedCount >= maxHistoryEvents && state.queued.length > 0;
}

export async function processNextMergeQueueEntry(
  input: MergeQueueWorkflowInput,
  state: MergeQueueMutableState,
  mergeActivities: MergeQueueActivities,
  signalResult: (ticketWorkflowId: string, result: MergeQueueResult) => Promise<void>,
): Promise<MergeQueueResult | null> {
  const next = state.queued.shift();
  if (!next) return null;

  state.active = next;
  const result = await processMergeQueueRequest(input, next.request, mergeActivities);
  recordMergeQueueResult(state, next.request, result);
  state.active = null;
  await signalResult(next.request.ticketWorkflowId, result);
  return result;
}

function hasMergeQueueRequest(
  state: Pick<MergeQueueMutableState, "queued" | "active" | "completed">,
  request: MergeQueueRequest,
): boolean {
  return (
    state.queued.some(
      (entry) =>
        entry.request.ticketId === request.ticketId ||
        entry.request.requestId === request.requestId,
    ) ||
    state.active?.request.ticketId === request.ticketId ||
    state.active?.request.requestId === request.requestId ||
    state.completed.has(request.ticketId) ||
    state.completed.has(request.requestId)
  );
}

async function readExistingVerifiedMergeRequests(
  input: MergeQueueWorkflowInput,
): Promise<readonly MergeQueueRequest[]> {
  const tickets = await mergeQueueActivityProxies.readVerifiedMergeQueueActivity({
    repoRoot: input.repoRoot,
  });
  return tickets.map((ticket) => ({
    requestId: mergeQueueRequestId(ticket.ticketId, ticket.commitSha),
    ticketId: ticket.ticketId,
    ticketWorkflowId: ticketWorkflowId(ticket.ticketId),
    title: ticket.title,
    branch: ticket.branch,
    commitSha: ticket.commitSha,
    strategy: "merge",
    acceptanceCriteria: ticket.acceptanceCriteria,
    comments: ticket.comments,
    requestedAt: new Date(0).toISOString(),
    runtimeLogRoot: input.runtimeLogRoot,
  }));
}

export function mergeQueueRequestId(ticketId: string, commitSha: string | null): string {
  const safeTicketId = ticketId.replace(/[^a-zA-Z0-9]+/g, "_");
  const safeCommit = (commitSha ?? "unknown").replace(/[^a-zA-Z0-9]+/g, "_");
  return `merge_${safeTicketId}_${safeCommit}`;
}

function ticketStatusFromMergeResult(
  result: MergeQueueResult,
): TicketWorkflowRunnerResult["status"] {
  switch (result.status) {
    case "merged":
      return "merged";
    case "retryable-failure":
      return "failed";
    case "human-blocked":
      return "human";
  }
}

function mergeWorkflowResultFromQueueResult(result: MergeQueueResult): MergeWorkflowResult {
  switch (result.status) {
    case "merged":
      return {
        ticketId: result.ticketId,
        status: "merged",
        failedStep: null,
        pushed: true,
        closed: true,
        humanEscalated: false,
        steps: [],
      };
    case "retryable-failure":
      return failedMerge(result.ticketId, result.failedStep, [], false);
    case "human-blocked":
      return failedMerge(result.ticketId, result.failedStep, [], true);
  }
}

function humanBlocked(
  request: MergeQueueRequest,
  failedStep: MergeQueueStep,
  reason: string,
): MergeQueueResult {
  return {
    status: "human-blocked",
    ticketId: request.ticketId,
    requestId: request.requestId,
    failedStep,
    reason,
  };
}

function activityFailureReason(result: commandActivities.MergeActivityResult): string {
  const failed = result.records.find((record) => record.exitCode !== 0);
  return failed?.stderr.trim() || failed?.stdout.trim() || "activity failed";
}

function mergeQueueStepFromLegacy(step: MergeWorkflowStep | null): MergeQueueStep {
  switch (step) {
    case "assert-clean-main":
    case "update-main":
    case "merge-ticket-branch":
    case "final-gates":
    case "push-main":
    case "close-ticket":
    case "push-beads":
      return step;
    case "merge-fix":
    case "escalate-human":
    case null:
      return "merge-ticket-branch";
  }
}

function failedTicketWorkflowRunner(
  ticketId: string,
  steps: readonly TicketWorkflowRunnerStepResult[],
  worktree?: commandActivities.CreateTicketWorktreeResult,
  builderSessionName: string | null = null,
  reviewerSessionName: string | null = null,
): TicketWorkflowRunnerResult {
  return {
    ticketId,
    status: "failed",
    branch: worktree?.branchName ?? null,
    worktreePath: worktree?.worktreePath ?? null,
    commitSha: null,
    builderSessionName,
    reviewerSessionName,
    mergeResult: null,
    steps,
  };
}

function humanTicketWorkflowRunner(
  ticketId: string,
  steps: readonly TicketWorkflowRunnerStepResult[],
  worktree: commandActivities.CreateTicketWorktreeResult,
  commitSha: string,
  builderSessionName: string,
  reviewerSessionName: string,
): TicketWorkflowRunnerResult {
  return {
    ticketId,
    status: "human",
    branch: worktree.branchName,
    worktreePath: worktree.worktreePath,
    commitSha,
    builderSessionName,
    reviewerSessionName,
    mergeResult: null,
    steps,
  };
}

function agentOutput(result: commandActivities.WaitForTmuxSessionResult): string {
  return [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
}

type TicketRunMetadataInput = {
  readonly phase: string;
  readonly attempt: number;
  readonly branch: string;
  readonly worktreePath: string;
  readonly run: Pick<
    commandActivities.StartTmuxCommandResult,
    "sessionName" | "stdoutLogPath" | "stderrLogPath"
  > & { readonly promptPath: string };
  readonly openCodeSession?: string;
  readonly commit?: string;
  readonly lastResult: string;
};

function ticketRunMetadata(input: TicketRunMetadataInput): TicketWorkflowMetadata {
  return {
    phase: input.phase,
    attempt: input.attempt,
    branch: input.branch,
    worktree: input.worktreePath,
    tmuxSession: input.run.sessionName,
    promptPath: input.run.promptPath,
    stdoutLog: input.run.stdoutLogPath,
    stderrLog: input.run.stderrLogPath,
    openCodeSession: input.openCodeSession ?? "",
    commit: input.commit ?? "",
    lastResult: input.lastResult,
  };
}

function phaseFromReviewerHandoff(
  handoff: commandActivities.ReviewerHandoffResult["handoff"],
): string {
  switch (handoff) {
    case "verified":
      return "verified";
    case "retry":
      return "build";
    case "human":
      return "human";
    case "missing":
    case "ambiguous":
      return "review";
  }
}

function formatOpenCodeSession(title: string | null, sessionId: string | null): string {
  if (!sessionId) return "unknown";
  return title ? `${title} (${sessionId})` : sessionId;
}

function applySignal(
  state: TicketWorkflowState,
  signal: TicketWorkflowSignal,
): TicketWorkflowState {
  return transitionTicketWorkflow(state, { type: "signal", signal });
}

function failedMerge(
  ticketId: string,
  failedStep: MergeWorkflowStep,
  steps: readonly MergeWorkflowStepResult[],
  humanEscalated = steps.some((step) => step.step === "escalate-human" && step.ok),
): MergeWorkflowResult {
  return {
    ticketId,
    status: "failed",
    failedStep,
    pushed: steps.some((step) => step.step === "push-main" && step.ok),
    closed: steps.some((step) => step.step === "close-ticket" && step.ok),
    humanEscalated,
    steps,
  };
}
