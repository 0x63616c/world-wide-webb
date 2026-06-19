import { defineQuery, defineSignal, proxyActivities, setHandler } from "@temporalio/workflow";
import type * as projectActivities from "./activities";
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

const mergeActivityProxies = proxyActivities<typeof commandActivities>({
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
  readonly repoRoot: string;
  readonly branch: string;
  readonly commitSha?: string;
  readonly strategy: "cherry-pick" | "merge";
  readonly finalGates: readonly commandActivities.FinalGateCommand[];
};

export type MergeWorkflowStep =
  | "update-main"
  | "merge-ticket-branch"
  | "final-gates"
  | "push-main"
  | "close-ticket";

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
>;

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
  if (!mergeBranch.ok) return failedMerge(input.ticketId, "merge-ticket-branch", steps);

  const finalGates = await mergeActivities.runFinalGatesActivity({
    repoRoot: input.repoRoot,
    gates: input.finalGates,
  });
  steps.push({ step: "final-gates", ...finalGates });
  if (!finalGates.ok) return failedMerge(input.ticketId, "final-gates", steps);

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
): MergeWorkflowResult {
  return {
    ticketId,
    status: "failed",
    failedStep,
    pushed: steps.some((step) => step.step === "push-main" && step.ok),
    closed: steps.some((step) => step.step === "close-ticket" && step.ok),
    steps,
  };
}
