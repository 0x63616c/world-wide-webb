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
