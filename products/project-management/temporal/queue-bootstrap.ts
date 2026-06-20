import { Client, Connection } from "@temporalio/client";
import { WorkflowIdConflictPolicy } from "@temporalio/common";
import {
  MERGE_QUEUE_WORKFLOW_ID,
  mergeQueueWorkflow,
  STUCK_TICKET_RECOVERY_WORKFLOW_ID,
  stuckTicketRecoveryWorkflow,
  ticketQueueWorkflow,
} from "./workflows";

export { MERGE_QUEUE_WORKFLOW_ID, STUCK_TICKET_RECOVERY_WORKFLOW_ID } from "./workflows";

export const TICKET_QUEUE_WORKFLOW_ID = "ticket_queue";
export const LEGACY_TICKET_QUEUE_WORKFLOW_ID = "ticket_queue_main";
export const TICKET_QUEUE_TASK_QUEUE = "project-management";
export type TicketQueueBootstrapOptions = {
  readonly address: string;
  readonly namespace: string;
  readonly taskQueue: string;
};

export type TicketQueueBootstrapResult = {
  readonly workflowId: typeof TICKET_QUEUE_WORKFLOW_ID;
  readonly taskQueue: string;
  readonly namespace: string;
};

export type TicketQueueWorkflowStartClient = {
  readonly workflow: {
    start(
      workflow:
        | typeof ticketQueueWorkflow
        | typeof mergeQueueWorkflow
        | typeof stuckTicketRecoveryWorkflow,
      options: {
        readonly workflowId:
          | typeof TICKET_QUEUE_WORKFLOW_ID
          | typeof MERGE_QUEUE_WORKFLOW_ID
          | typeof STUCK_TICKET_RECOVERY_WORKFLOW_ID;
        readonly workflowIdConflictPolicy: WorkflowIdConflictPolicy;
        readonly taskQueue: string;
        readonly args?: readonly unknown[];
      },
    ): Promise<unknown>;
    getHandle(workflowId: string): {
      terminate(reason?: string): Promise<unknown>;
    };
  };
};

export function defaultTicketQueueBootstrapOptions(): TicketQueueBootstrapOptions {
  return {
    address: Bun.env.TEMPORAL_ADDRESS ?? "127.0.0.1:7233",
    namespace: Bun.env.TEMPORAL_NAMESPACE ?? "project-management",
    taskQueue: Bun.env.TEMPORAL_TASK_QUEUE ?? TICKET_QUEUE_TASK_QUEUE,
  };
}

export async function ensureTicketQueueWorkflow(
  options = defaultTicketQueueBootstrapOptions(),
): Promise<TicketQueueBootstrapResult> {
  const connection = await Connection.connect({ address: options.address });
  const client = new Client({ connection, namespace: options.namespace });
  await ensureTicketQueueWorkflowWithClient(client as TicketQueueWorkflowStartClient, options);

  return {
    workflowId: TICKET_QUEUE_WORKFLOW_ID,
    taskQueue: options.taskQueue,
    namespace: options.namespace,
  };
}

export async function ensureTicketQueueWorkflowWithClient(
  client: TicketQueueWorkflowStartClient,
  options: Omit<TicketQueueBootstrapOptions, "address" | "namespace"> &
    Partial<Pick<TicketQueueBootstrapOptions, "address" | "namespace">>,
): Promise<void> {
  await client.workflow.start(ticketQueueWorkflow, {
    workflowId: TICKET_QUEUE_WORKFLOW_ID,
    workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
    taskQueue: options.taskQueue,
  });
  await client.workflow.start(mergeQueueWorkflow, {
    workflowId: MERGE_QUEUE_WORKFLOW_ID,
    workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
    taskQueue: options.taskQueue,
  });
  await client.workflow.start(stuckTicketRecoveryWorkflow, {
    workflowId: STUCK_TICKET_RECOVERY_WORKFLOW_ID,
    workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
    taskQueue: options.taskQueue,
  });
  await terminateLegacyTicketQueueWorkflow(client);
}

async function terminateLegacyTicketQueueWorkflow(
  client: TicketQueueWorkflowStartClient,
): Promise<void> {
  try {
    await client.workflow
      .getHandle(LEGACY_TICKET_QUEUE_WORKFLOW_ID)
      .terminate(`renamed to ${TICKET_QUEUE_WORKFLOW_ID}`);
  } catch (error) {
    if (isIgnorableLegacyTicketQueueTerminationError(error)) return;
    throw error;
  }
}

function isIgnorableLegacyTicketQueueTerminationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const errorText = `${error.name} ${error.message}`.toLowerCase();
  return (
    errorText.includes("not found") ||
    errorText.includes("not_found") ||
    errorText.includes("notfound") ||
    errorText.includes("already closed") ||
    errorText.includes("already completed") ||
    errorText.includes("workflow execution already")
  );
}
