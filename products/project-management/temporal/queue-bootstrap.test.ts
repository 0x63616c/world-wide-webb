import { WorkflowIdConflictPolicy } from "@temporalio/common";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TICKET_QUEUE_FINAL_GATES,
  ensureTicketQueueWorkflowWithClient,
  TICKET_QUEUE_WORKFLOW_ID,
} from "./queue-bootstrap";
import { ticketQueueWorkflow } from "./workflows";

describe("ensureTicketQueueWorkflowWithClient", () => {
  it("starts the long-lived queue workflow with an idempotent workflow id", async () => {
    const starts: unknown[] = [];
    await ensureTicketQueueWorkflowWithClient(
      {
        workflow: {
          start: async (...args: unknown[]) => {
            starts.push(args);
          },
        },
      },
      {
        repoRoot: "/repo",
        taskQueue: "project-management",
        runtimeLogRoot: "/logs",
      },
    );

    expect(starts).toEqual([
      [
        ticketQueueWorkflow,
        {
          workflowId: TICKET_QUEUE_WORKFLOW_ID,
          workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
          taskQueue: "project-management",
          args: [
            {
              repoRoot: "/repo",
              finalGates: DEFAULT_TICKET_QUEUE_FINAL_GATES,
              runtimeLogRoot: "/logs",
              baseRef: "origin/main",
              requirePushedBranch: true,
              pollIntervalMs: 15_000,
            },
          ],
        },
      ],
    ]);
  });
});
