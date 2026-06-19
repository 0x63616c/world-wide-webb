import { defineQuery, defineSignal, proxyActivities, setHandler } from "@temporalio/workflow";
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
  | "write-builder-metadata"
  | "write-builder-comment"
  | "move-review"
  | "start-reviewer"
  | "wait-reviewer"
  | "write-reviewer-comment"
  | "move-verified"
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
  | "escalateTicketHumanActivity"
> &
  Pick<typeof agentActivities, "startTicketMergeFixActivity">;

export type TicketWorkflowRunnerActivities = Pick<
  typeof commandActivities,
  | "claimTicketActivity"
  | "createTicketWorktreeActivity"
  | "waitForTmuxSessionActivity"
  | "resolveGitHeadActivity"
  | "writeTicketWorkflowMetadataActivity"
  | "writeTicketCommentActivity"
  | "moveTicketToReviewActivity"
  | "moveTicketToVerifiedActivity"
> &
  Pick<
    typeof agentActivities,
    | "startTicketBuilderActivity"
    | "startTicketReviewerActivity"
    | "parseTicketReviewerVerdictActivity"
  > &
  MergeWorkflowActivities;

const ticketWorkflowRunnerActivityProxies = proxyActivities<TicketWorkflowRunnerActivities>({
  startToCloseTimeout: "10 minutes",
});

export async function mergeWorkflow(
  input: MergeWorkflowQueueInput,
): Promise<MergeWorkflowQueueResult> {
  return runSerializedMergeQueueWorkflow(input, mergeActivityProxies);
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

  const builder = await runnerActivities.startTicketBuilderActivity({
    ticketId: input.ticketId,
    title: input.title,
    worktreePath: worktree.worktreePath,
    attempt: 1,
    acceptanceCriteria: input.acceptanceCriteria,
    comments: input.comments ?? [],
    runtimeLogRoot: input.runtimeLogRoot,
  });
  steps.push({
    step: "start-builder",
    ok: builder.records.every((record) => record.exitCode === 0),
  });
  if (builder.records.some((record) => record.exitCode !== 0)) {
    return failedTicketWorkflowRunner(input.ticketId, steps, worktree, builder.sessionName);
  }

  const builderWait = await runnerActivities.waitForTmuxSessionActivity({
    sessionName: builder.sessionName,
    stdoutLogPath: builder.stdoutLogPath,
    stderrLogPath: builder.stderrLogPath,
    exitCodePath: builder.exitCodePath,
  });
  steps.push({ step: "wait-builder", ok: builderWait.completed && builderWait.exitCode === 0 });
  if (!builderWait.completed || builderWait.exitCode !== 0)
    return failedTicketWorkflowRunner(input.ticketId, steps, worktree, builder.sessionName);

  const head = await runnerActivities.resolveGitHeadActivity({
    repoRoot: worktree.worktreePath,
    ref: "HEAD",
  });
  steps.push({ step: "resolve-commit", ok: head.ok });
  if (!head.ok || !head.commitSha)
    return failedTicketWorkflowRunner(input.ticketId, steps, worktree, builder.sessionName);

  const metadata = await runnerActivities.writeTicketWorkflowMetadataActivity({
    ticketId: input.ticketId,
    repoRoot: input.repoRoot,
    metadata: {
      phase: "review",
      attempts: 1,
      branch: worktree.branchName,
      worktree: worktree.worktreePath,
      tmuxSession: builder.sessionName,
      openCodeSession: builder.sessionName,
      commit: head.commitSha,
      lastResult: "builder-passed",
    },
  });
  steps.push({ step: "write-builder-metadata", ok: metadata.ok });

  const builderComment = await runnerActivities.writeTicketCommentActivity({
    ticketId: input.ticketId,
    repoRoot: input.repoRoot,
    kind: "builder-summary",
    body: builderWait.stdout || "Builder completed with no stdout.",
  });
  steps.push({ step: "write-builder-comment", ok: builderComment.ok });

  const reviewMove = await runnerActivities.moveTicketToReviewActivity({
    ticketId: input.ticketId,
    repoRoot: input.repoRoot,
  });
  steps.push({ step: "move-review", ok: reviewMove.ok });
  if (!metadata.ok || !builderComment.ok || !reviewMove.ok) {
    return failedTicketWorkflowRunner(input.ticketId, steps, worktree, builder.sessionName);
  }

  const reviewer = await runnerActivities.startTicketReviewerActivity({
    ticketId: input.ticketId,
    title: input.title,
    branch: worktree.branchName,
    worktreePath: worktree.worktreePath,
    attempt: 1,
    acceptanceCriteria: input.acceptanceCriteria,
    comments: [...(input.comments ?? []), builderWait.stdout].filter(Boolean),
    runtimeLogRoot: input.runtimeLogRoot,
  });
  steps.push({
    step: "start-reviewer",
    ok: reviewer.records.every((record) => record.exitCode === 0),
  });
  if (reviewer.records.some((record) => record.exitCode !== 0)) {
    return failedTicketWorkflowRunner(
      input.ticketId,
      steps,
      worktree,
      builder.sessionName,
      reviewer.sessionName,
    );
  }

  const reviewerWait = await runnerActivities.waitForTmuxSessionActivity({
    sessionName: reviewer.sessionName,
    stdoutLogPath: reviewer.stdoutLogPath,
    stderrLogPath: reviewer.stderrLogPath,
    exitCodePath: reviewer.exitCodePath,
  });
  steps.push({ step: "wait-reviewer", ok: reviewerWait.completed && reviewerWait.exitCode === 0 });
  if (!reviewerWait.completed || reviewerWait.exitCode !== 0) {
    return failedTicketWorkflowRunner(
      input.ticketId,
      steps,
      worktree,
      builder.sessionName,
      reviewer.sessionName,
    );
  }

  const verdict = await runnerActivities.parseTicketReviewerVerdictActivity(reviewerWait.stdout);
  const reviewerComment = await runnerActivities.writeTicketCommentActivity({
    ticketId: input.ticketId,
    repoRoot: input.repoRoot,
    kind: "reviewer-findings",
    body: reviewerWait.stdout,
  });
  steps.push({ step: "write-reviewer-comment", ok: reviewerComment.ok });
  if (verdict.verdict !== "pass" || !reviewerComment.ok) {
    return failedTicketWorkflowRunner(
      input.ticketId,
      steps,
      worktree,
      builder.sessionName,
      reviewer.sessionName,
    );
  }

  const verified = await runnerActivities.moveTicketToVerifiedActivity({
    ticketId: input.ticketId,
    repoRoot: input.repoRoot,
  });
  steps.push({ step: "move-verified", ok: verified.ok });
  if (!verified.ok) {
    return failedTicketWorkflowRunner(
      input.ticketId,
      steps,
      worktree,
      builder.sessionName,
      reviewer.sessionName,
    );
  }

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
      comments: input.comments,
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
