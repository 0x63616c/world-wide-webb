export const ISSUE_STATES = ["ready", "in_progress", "blocked", "closed"] as const;

export type IssueState = (typeof ISSUE_STATES)[number];

export type IssueTransitionEvent =
  | { type: "claim" }
  | { type: "block" }
  | { type: "unblock" }
  | { type: "close" }
  | { type: "reopen" };

export type IssueTransitionInput = {
  readonly issueId: string;
  readonly state: IssueState;
  readonly event: IssueTransitionEvent;
};

export type IssueTransitionResult = {
  readonly issueId: string;
  readonly previousState: IssueState;
  readonly nextState: IssueState;
};

export function transitionIssueState(input: IssueTransitionInput): IssueTransitionResult {
  return {
    issueId: input.issueId,
    previousState: input.state,
    nextState: nextStateFor(input.state, input.event),
  };
}

function nextStateFor(state: IssueState, event: IssueTransitionEvent): IssueState {
  switch (event.type) {
    case "claim":
      return state === "closed" ? "closed" : "in_progress";
    case "block":
      return state === "closed" ? "closed" : "blocked";
    case "unblock":
      return state === "blocked" ? "ready" : state;
    case "close":
      return "closed";
    case "reopen":
      return state === "closed" ? "ready" : state;
  }
}

export const TICKET_WORKFLOW_PHASES = [
  "ready",
  "build",
  "review",
  "verified",
  "merge",
  "closed",
  "human",
] as const;

export type TicketWorkflowPhase = (typeof TICKET_WORKFLOW_PHASES)[number];

export type TicketWorkflowOutcome =
  | "builder-passed"
  | "builder-failed"
  | "builder-timeout"
  | "builder-step-exhausted"
  | "reviewer-passed"
  | "reviewer-failed"
  | "reviewer-timeout"
  | "reviewer-step-exhausted"
  | "merge-passed"
  | "merge-failed";

export type TicketWorkflowSignal =
  | { readonly type: "pause" }
  | { readonly type: "resume" }
  | { readonly type: "retry" }
  | { readonly type: "mark-human"; readonly reason: string }
  | { readonly type: "cancel"; readonly reason: string };

export type TicketWorkflowEvent =
  | { readonly type: "start-build" }
  | { readonly type: "complete-step"; readonly outcome: TicketWorkflowOutcome }
  | { readonly type: "signal"; readonly signal: TicketWorkflowSignal };

export type TicketWorkflowOptions = {
  readonly maxBuilderAttempts: number;
  readonly maxReviewerAttempts: number;
};

export type TicketWorkflowState = {
  readonly ticketId: string;
  readonly phase: TicketWorkflowPhase;
  readonly builderAttempts: number;
  readonly reviewerAttempts: number;
  readonly paused: boolean;
  readonly terminalReason: string | null;
  readonly lastOutcome: TicketWorkflowOutcome | null;
  readonly history: readonly string[];
};

export const DEFAULT_TICKET_WORKFLOW_OPTIONS = {
  maxBuilderAttempts: 2,
  maxReviewerAttempts: 2,
} as const satisfies TicketWorkflowOptions;

export function initialTicketWorkflowState(ticketId: string): TicketWorkflowState {
  return {
    ticketId,
    phase: "ready",
    builderAttempts: 0,
    reviewerAttempts: 0,
    paused: false,
    terminalReason: null,
    lastOutcome: null,
    history: ["ready"],
  };
}

export function transitionTicketWorkflow(
  state: TicketWorkflowState,
  event: TicketWorkflowEvent,
  options: TicketWorkflowOptions = DEFAULT_TICKET_WORKFLOW_OPTIONS,
): TicketWorkflowState {
  if (state.phase === "closed" || state.phase === "human") return state;
  if (event.type === "signal") return applyTicketWorkflowSignal(state, event.signal);
  if (state.paused) return state;

  switch (event.type) {
    case "start-build":
      return enterPhase(state, "build", {
        builderAttempts: state.builderAttempts + 1,
        lastOutcome: null,
      });
    case "complete-step":
      return applyStepOutcome(state, event.outcome, options);
  }
}

export function applyTicketWorkflowEvents(
  ticketId: string,
  events: readonly TicketWorkflowEvent[],
  options: TicketWorkflowOptions = DEFAULT_TICKET_WORKFLOW_OPTIONS,
): TicketWorkflowState {
  let state = initialTicketWorkflowState(ticketId);
  for (const event of events) state = transitionTicketWorkflow(state, event, options);
  return state;
}

function applyTicketWorkflowSignal(
  state: TicketWorkflowState,
  signal: TicketWorkflowSignal,
): TicketWorkflowState {
  switch (signal.type) {
    case "pause":
      return { ...state, paused: true, history: [...state.history, "pause"] };
    case "resume":
      return { ...state, paused: false, history: [...state.history, "resume"] };
    case "retry":
      return enterPhase({ ...state, paused: false }, "build", {
        builderAttempts: state.builderAttempts + 1,
        lastOutcome: null,
      });
    case "mark-human":
      return enterPhase(state, "human", { terminalReason: signal.reason });
    case "cancel":
      return enterPhase(state, "human", { terminalReason: `cancelled: ${signal.reason}` });
  }
}

function applyStepOutcome(
  state: TicketWorkflowState,
  outcome: TicketWorkflowOutcome,
  options: TicketWorkflowOptions,
): TicketWorkflowState {
  switch (outcome) {
    case "builder-passed":
      return enterPhase(state, "review", {
        reviewerAttempts: state.reviewerAttempts + 1,
        lastOutcome: outcome,
      });
    case "builder-failed":
    case "builder-timeout":
    case "builder-step-exhausted":
      return retryOrHuman(
        state,
        "build",
        outcome,
        state.builderAttempts,
        options.maxBuilderAttempts,
      );
    case "reviewer-passed":
      return enterPhase(state, "verified", { lastOutcome: outcome });
    case "reviewer-failed":
    case "reviewer-timeout":
    case "reviewer-step-exhausted":
      return retryOrHuman(
        state,
        "review",
        outcome,
        state.reviewerAttempts,
        options.maxReviewerAttempts,
      );
    case "merge-passed":
      return enterPhase(state, "closed", { lastOutcome: outcome, terminalReason: "merged" });
    case "merge-failed":
      return enterPhase(state, "human", { lastOutcome: outcome, terminalReason: outcome });
  }
}

function retryOrHuman(
  state: TicketWorkflowState,
  failedPhase: "build" | "review",
  outcome: TicketWorkflowOutcome,
  attempts: number,
  maxAttempts: number,
): TicketWorkflowState {
  if (attempts >= maxAttempts) {
    return enterPhase(state, "human", { lastOutcome: outcome, terminalReason: outcome });
  }
  if (failedPhase === "build") {
    return enterPhase(state, "build", {
      builderAttempts: state.builderAttempts + 1,
      lastOutcome: outcome,
    });
  }
  return enterPhase(state, "review", {
    reviewerAttempts: state.reviewerAttempts + 1,
    lastOutcome: outcome,
  });
}

function enterPhase(
  state: TicketWorkflowState,
  phase: TicketWorkflowPhase,
  patch: Partial<Omit<TicketWorkflowState, "ticketId" | "phase" | "history">> = {},
): TicketWorkflowState {
  return {
    ...state,
    ...patch,
    phase,
    history: [...state.history, phase],
  };
}
