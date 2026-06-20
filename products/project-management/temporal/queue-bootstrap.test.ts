import { WorkflowIdConflictPolicy } from "@temporalio/common";
import { describe, expect, it } from "vitest";
import {
  ensureTicketQueueWorkflowWithClient,
  LEGACY_TICKET_QUEUE_WORKFLOW_ID,
  MERGE_QUEUE_WORKFLOW_ID,
  STUCK_TICKET_RECOVERY_WORKFLOW_ID,
  TICKET_QUEUE_WORKFLOW_ID,
} from "./queue-bootstrap";
import { mergeQueueWorkflow, stuckTicketRecoveryWorkflow, ticketQueueWorkflow } from "./workflows";

describe("ensureTicketQueueWorkflowWithClient", () => {
  it("uses the renamed ticket queue workflow id", () => {
    expect(TICKET_QUEUE_WORKFLOW_ID).toBe("ticket_queue");
  });

  it("starts the long-lived queue workflow with an idempotent workflow id and safe cap", async () => {
    const starts: unknown[] = [];
    const terminations: unknown[] = [];
    await ensureTicketQueueWorkflowWithClient(
      {
        workflow: {
          start: async (...args: unknown[]) => {
            starts.push(args);
          },
          getHandle: (workflowId: string) => ({
            terminate: async (reason?: string) => {
              terminations.push({ workflowId, reason });
            },
          }),
        },
      },
      {
        taskQueue: "main",
      },
    );

    expect(starts).toEqual([
      [
        ticketQueueWorkflow,
        {
          workflowId: TICKET_QUEUE_WORKFLOW_ID,
          workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
          taskQueue: "main",
        },
      ],
      [
        mergeQueueWorkflow,
        {
          workflowId: MERGE_QUEUE_WORKFLOW_ID,
          workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
          taskQueue: "main",
        },
      ],
      [
        stuckTicketRecoveryWorkflow,
        {
          workflowId: STUCK_TICKET_RECOVERY_WORKFLOW_ID,
          workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
          taskQueue: "main",
        },
      ],
    ]);
    expect(terminations).toEqual([
      {
        workflowId: LEGACY_TICKET_QUEUE_WORKFLOW_ID,
        reason: `renamed to ${TICKET_QUEUE_WORKFLOW_ID}`,
      },
    ]);
  });

  it("ensures the new workflow before terminating the legacy workflow", async () => {
    const events: string[] = [];
    await ensureTicketQueueWorkflowWithClient(
      {
        workflow: {
          start: async (_workflow, options) => {
            events.push(`start:${options.workflowId}`);
          },
          getHandle: (workflowId: string) => ({
            terminate: async () => {
              events.push(`terminate:${workflowId}`);
            },
          }),
        },
      },
      {
        taskQueue: "main",
      },
    );

    expect(events).toEqual([
      `start:${TICKET_QUEUE_WORKFLOW_ID}`,
      `start:${MERGE_QUEUE_WORKFLOW_ID}`,
      `start:${STUCK_TICKET_RECOVERY_WORKFLOW_ID}`,
      `terminate:${LEGACY_TICKET_QUEUE_WORKFLOW_ID}`,
    ]);
  });

  it.each([
    new Error("workflow not found"),
    Object.assign(new Error("Workflow execution already completed"), {
      name: "WorkflowExecutionAlreadyCompletedError",
    }),
  ])("ignores legacy termination errors for inactive workflows", async (error) => {
    await expect(
      ensureTicketQueueWorkflowWithClient(
        {
          workflow: {
            start: async () => {},
            getHandle: () => ({
              terminate: async () => {
                throw error;
              },
            }),
          },
        },
        {
          taskQueue: "main",
        },
      ),
    ).resolves.toBeUndefined();
  });

  it("does not reconcile verified tickets during bootstrap", async () => {
    const signals: unknown[] = [];
    await ensureTicketQueueWorkflowWithClient(
      {
        workflow: {
          start: async () => {},
          getHandle: (workflowId: string) => ({
            signal: async (...args: unknown[]) => {
              signals.push({ workflowId, args });
            },
            terminate: async () => {},
          }),
        },
      },
      {
        taskQueue: "main",
      },
    );

    expect(signals).toEqual([]);
  });
});
