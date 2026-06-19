import type { DesignIssue } from "./map";

const WORKFLOW_COLUMNS = [
  { id: "ready", title: "Ready" },
  { id: "in_progress", title: "In Progress" },
  { id: "blocked", title: "Blocked" },
  { id: "closed", title: "Closed" },
] as const satisfies readonly { id: DesignIssue["status"]; title: string }[];

export type WorkflowColumn = (typeof WORKFLOW_COLUMNS)[number] & {
  issueIds: string[];
};

export function workflowColumnsForIssues(
  issues: readonly Pick<DesignIssue, "id" | "status">[],
): WorkflowColumn[] {
  return WORKFLOW_COLUMNS.map((column) => ({
    ...column,
    issueIds: issues.filter((issue) => issue.status === column.id).map((issue) => issue.id),
  }));
}
