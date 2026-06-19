import {
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
  sleep,
  startChild,
} from "@temporalio/workflow";
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

export type MergeWorkflowStep =
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

export type TicketWorkflowRunnerStep =
  | "claim-ticket"
  | "create-worktree"
  | "start-builder"
  | "wait-builder"
  | "resolve-commit"
  | "resolve-builder-session"
  | "write-builder-metadata"
  | "verify-builder-handoff"
  | "start-reviewer"
  | "wait-reviewer"
  | "resolve-reviewer-session"
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

export type TicketQueueWorkflowInput = {
  readonly repoRoot: string;
  readonly finalGates: readonly commandActivities.FinalGateCommand[];
  readonly runtimeLogRoot?: string;
  readonly baseRef?: string;
  readonly requirePushedBranch?: boolean;
  readonly mergeStrategy?: "cherry-pick" | "merge";
  readonly pollIntervalMs?: number;
  readonly maxTicketsPerPoll?: number;
};

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

export async function ticketQueueWorkflow(input: TicketQueueWorkflowInput): Promise<never> {
  const pollIntervalMs = input.pollIntervalMs ?? 15_000;

  while (true) {
    const tickets = await ticketQueueActivityProxies.readReadyTicketWorkflowQueueActivity({
      repoRoot: input.repoRoot,
    });
    await runTicketQueueBatch(input, tickets, startTicketChildWorkflow);
    await sleep(pollIntervalMs);
  }
}

export async function runTicketQueueBatch(
  input: TicketQueueWorkflowInput,
  tickets: readonly commandActivities.ReadyTicketWorkflowQueueTicket[],
  start: TicketChildWorkflowStarter,
): Promise<TicketQueueWorkflowBatchResult> {
  const selectedTickets = tickets.slice(0, input.maxTicketsPerPoll ?? tickets.length);
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

async function startTicketChildWorkflow(
  child: TicketQueueWorkflowChildInput,
): Promise<"started" | "skipped"> {
  try {
    await startChild(ticketWorkflow, {
      workflowId: ticketWorkflowId(child.ticketId),
      args: [child.input],
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

    const builderWait = await runnerActivities.waitForAgentRunCompletionActivity({
      sessionName: builder.sessionName,
      stdoutLogPath: builder.stdoutLogPath,
      stderrLogPath: builder.stderrLogPath,
      exitCodePath: builder.exitCodePath,
    });
    steps.push({ step: "wait-builder", ok: builderWait.completed && builderWait.exitCode === 0 });
    if (!builderWait.completed || builderWait.exitCode !== 0) continue;

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
    if (!head.ok || !head.commitSha) continue;
    commitSha = head.commitSha;

    const metadata = await runnerActivities.writeTicketWorkflowMetadataActivity({
      ticketId: input.ticketId,
      repoRoot: input.repoRoot,
      metadata: {
        phase: "review",
        attempts: builderAttempt,
        branch: worktree.branchName,
        worktree: worktree.worktreePath,
        tmuxSession: builder.sessionName,
        openCodeSession: formatOpenCodeSession(
          builderOpenCodeSession.title,
          builderOpenCodeSession.sessionId,
        ),
        commit: head.commitSha,
        lastResult: "builder-passed",
      },
    });
    steps.push({ step: "write-builder-metadata", ok: metadata.ok });

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
      if (!reviewerWait.completed || reviewerWait.exitCode !== 0) continue;

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

      const mergeResult = await runSerializedMergeWorkflow(
        {
          ticketId: input.ticketId,
          title: input.title,
          repoRoot: input.repoRoot,
          branch: worktree.branchName,
          commitSha: head.commitSha,
          strategy: input.mergeStrategy ?? "merge",
          finalGates: input.finalGates,
          acceptanceCriteria: input.acceptanceCriteria,
          comments,
          runtimeLogRoot: input.runtimeLogRoot,
        },
        runnerActivities,
      );
      steps.push({ step: "merge", ok: mergeResult.status === "merged" });

      return {
        ticketId: input.ticketId,
        status: mergeResult.status === "merged" ? "merged" : "failed",
        branch: worktree.branchName,
        worktreePath: worktree.worktreePath,
        commitSha: head.commitSha,
        builderSessionName: builder.sessionName,
        reviewerSessionName: reviewer.sessionName,
        mergeResult,
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
