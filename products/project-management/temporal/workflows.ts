import { defineQuery, defineSignal, proxyActivities, setHandler } from "@temporalio/workflow";
import type * as projectActivities from "./activities";
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

export async function issueTransitionWorkflow(
  input: IssueTransitionInput,
): Promise<IssueTransitionResult> {
  return transitionIssueState(input);
}

export async function projectSnapshotWorkflow(): Promise<projectActivities.ProjectSnapshot> {
  return activities.loadProjectSnapshot();
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
