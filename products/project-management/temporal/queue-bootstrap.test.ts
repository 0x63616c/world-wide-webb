import { WorkflowIdConflictPolicy } from "@temporalio/common";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_ACTIVE_TICKET_WORKFLOWS,
  DEFAULT_MAX_TICKETS_PER_POLL,
  DEFAULT_TICKET_QUEUE_FINAL_GATES,
  ensureTicketQueueWorkflowWithClient,
  LEGACY_TICKET_QUEUE_WORKFLOW_ID,
  MERGE_QUEUE_WORKFLOW_ID,
  STUCK_TICKET_RECOVERY_WORKFLOW_ID,
  TICKET_QUEUE_WORKFLOW_ID,
} from "./queue-bootstrap";
import {
  enqueueMergeSignal,
  mergeQueueWorkflow,
  stuckTicketRecoveryWorkflow,
  ticketQueueWorkflow,
  updateTicketQueueConfigSignal,
} from "./workflows";

describe("ensureTicketQueueWorkflowWithClient", () => {
  it("uses the renamed ticket queue workflow id", () => {
    expect(TICKET_QUEUE_WORKFLOW_ID).toBe("ticket_queue");
  });

  it("starts the long-lived queue workflow with an idempotent workflow id and safe cap", async () => {
    const starts: unknown[] = [];
    const signals: unknown[] = [];
    const terminations: unknown[] = [];
    await ensureTicketQueueWorkflowWithClient(
      {
        workflow: {
          start: async (...args: unknown[]) => {
            starts.push(args);
          },
          getHandle: (workflowId: string) => ({
            signal: async (...args: unknown[]) => {
              signals.push({ workflowId, args });
            },
            terminate: async (reason?: string) => {
              terminations.push({ workflowId, reason });
            },
          }),
        },
      },
      {
        repoRoot: "/repo",
        taskQueue: "main",
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
          taskQueue: "main",
          args: [
            {
              repoRoot: "/repo",
              finalGates: DEFAULT_TICKET_QUEUE_FINAL_GATES,
              runtimeLogRoot: "/logs",
              baseRef: "HEAD",
              requirePushedBranch: true,
              pollIntervalMs: 15_000,
              maxActiveTicketWorkflows: DEFAULT_MAX_ACTIVE_TICKET_WORKFLOWS,
              maxTicketsPerPoll: DEFAULT_MAX_TICKETS_PER_POLL,
            },
          ],
        },
      ],
      [
        mergeQueueWorkflow,
        {
          workflowId: MERGE_QUEUE_WORKFLOW_ID,
          workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
          taskQueue: "main",
          args: [
            {
              repoRoot: "/repo",
              taskQueue: "main",
              finalGates: DEFAULT_TICKET_QUEUE_FINAL_GATES,
              runtimeLogRoot: "/logs",
              maxMergeAttempts: 3,
              maxHistoryEvents: 100,
            },
          ],
        },
      ],
      [
        stuckTicketRecoveryWorkflow,
        {
          workflowId: STUCK_TICKET_RECOVERY_WORKFLOW_ID,
          workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
          taskQueue: "main",
          args: [
            {
              repoRoot: "/repo",
              runtimeLogRoot: "/logs",
              temporalAddress: "127.0.0.1:7233",
              temporalNamespace: "project-management",
              pollIntervalMs: 60_000,
              maxTicketsPerPoll: 10,
            },
          ],
        },
      ],
    ]);
    expect(signals).toEqual([
      {
        workflowId: TICKET_QUEUE_WORKFLOW_ID,
        args: [
          updateTicketQueueConfigSignal,
          {
            maxActiveTicketWorkflows: DEFAULT_MAX_ACTIVE_TICKET_WORKFLOWS,
            maxTicketsPerPoll: DEFAULT_MAX_TICKETS_PER_POLL,
          },
        ],
      },
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
        taskQueue: "main",
        runtimeLogRoot: "/logs",
      },
      async () => [],
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
          repoRoot: "/repo",
          taskQueue: "main",
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
        taskQueue: "main",
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
        workflowId: TICKET_QUEUE_WORKFLOW_ID,
        args: [
          updateTicketQueueConfigSignal,
          {
            maxActiveTicketWorkflows: DEFAULT_MAX_ACTIVE_TICKET_WORKFLOWS,
            maxTicketsPerPoll: DEFAULT_MAX_TICKETS_PER_POLL,
          },
        ],
      },
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
