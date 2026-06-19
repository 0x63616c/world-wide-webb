import { WorkflowIdConflictPolicy } from "@temporalio/common";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TICKET_QUEUE_FINAL_GATES,
  ensureTicketQueueWorkflowWithClient,
  LEGACY_TICKET_QUEUE_WORKFLOW_ID,
  MERGE_QUEUE_WORKFLOW_ID,
  TICKET_QUEUE_WORKFLOW_ID,
} from "./queue-bootstrap";
import { enqueueMergeSignal, mergeQueueWorkflow, ticketQueueWorkflow } from "./workflows";

describe("ensureTicketQueueWorkflowWithClient", () => {
  it("uses the renamed ticket queue workflow id", () => {
    expect(TICKET_QUEUE_WORKFLOW_ID).toBe("ticket_queue");
  });

  it("starts the long-lived queue workflow with an idempotent workflow id", async () => {
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
        repoRoot: "/repo",
        taskQueue: "project-management",
        runtimeLogRoot: "/logs",
      },
      async () => [],
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
      [
        mergeQueueWorkflow,
        {
          workflowId: MERGE_QUEUE_WORKFLOW_ID,
          workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
          taskQueue: "project-management",
          args: [
            {
              repoRoot: "/repo",
              taskQueue: "project-management",
              finalGates: DEFAULT_TICKET_QUEUE_FINAL_GATES,
              runtimeLogRoot: "/logs",
              maxMergeAttempts: 3,
              maxHistoryEvents: 100,
            },
          ],
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
        repoRoot: "/repo",
        taskQueue: "project-management",
        runtimeLogRoot: "/logs",
      },
      async () => [],
    );

    expect(events).toEqual([
      `start:${TICKET_QUEUE_WORKFLOW_ID}`,
      `start:${MERGE_QUEUE_WORKFLOW_ID}`,
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
          repoRoot: "/repo",
          taskQueue: "project-management",
          runtimeLogRoot: "/logs",
        },
        async () => [],
      ),
    ).resolves.toBeUndefined();
  });

  it("signals existing verified tickets into an already-running merge queue on startup", async () => {
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
        repoRoot: "/repo",
        taskQueue: "project-management",
        runtimeLogRoot: "/logs",
      },
      async () => [
        {
          ticketId: "www-verified",
          title: "Verified ticket",
          acceptanceCriteria: "- [ ] verified",
          comments: ["reviewed"],
          branch: "www-verified-ticket",
          commitSha: "abc123",
        },
      ],
    );

    expect(signals).toEqual([
      {
        workflowId: MERGE_QUEUE_WORKFLOW_ID,
        args: [
          enqueueMergeSignal,
          expect.objectContaining({
            requestId: "merge_www_verified_abc123",
            ticketId: "www-verified",
            ticketWorkflowId: "ticket_www-verified",
            branch: "www-verified-ticket",
            commitSha: "abc123",
            runtimeLogRoot: "/logs",
          }),
        ],
      },
    ]);
  });
});
