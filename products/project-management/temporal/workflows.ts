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

const mergeCommandActivityProxies = proxyActivities<typeof commandActivities>({
  startToCloseTimeout: "10 minutes",
});

const mergeAgentActivityProxies = proxyActivities<typeof agentActivities>({
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

export async function mergeWorkflow(
  input: MergeWorkflowQueueInput,
): Promise<MergeWorkflowQueueResult> {
  return runSerializedMergeQueueWorkflow(input, {
    ...mergeCommandActivityProxies,
    ...mergeAgentActivityProxies,
  });
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

  return state;
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
