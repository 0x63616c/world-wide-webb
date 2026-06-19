import { proxyActivities } from "@temporalio/workflow";
import type * as projectActivities from "./activities";
import {
  type IssueTransitionInput,
  type IssueTransitionResult,
  transitionIssueState,
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
