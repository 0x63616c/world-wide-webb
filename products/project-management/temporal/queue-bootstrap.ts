import { Client, Connection } from "@temporalio/client";
import { WorkflowIdConflictPolicy } from "@temporalio/common";
import {
  defaultRuntimeLogRoot,
  type FinalGateCommand,
  readVerifiedMergeQueue,
  runCommand,
  type VerifiedMergeQueueTicket,
} from "./command-activities";
import {
  enqueueMergeSignal,
  MERGE_QUEUE_WORKFLOW_ID,
  type MergeQueueRequest,
  type MergeQueueWorkflowInput,
  mergeQueueRequestId,
  mergeQueueWorkflow,
  type TicketQueueConfig,
  type TicketQueueWorkflowInput,
  ticketQueueWorkflow,
  updateTicketQueueConfigSignal,
} from "./workflows";

export { MERGE_QUEUE_WORKFLOW_ID } from "./workflows";

export const TICKET_QUEUE_WORKFLOW_ID = "ticket_queue";
export const LEGACY_TICKET_QUEUE_WORKFLOW_ID = "ticket_queue_main";
export const TICKET_QUEUE_TASK_QUEUE = "project-management";
export const DEFAULT_MAX_ACTIVE_TICKET_WORKFLOWS = 3;
export const DEFAULT_MAX_TICKETS_PER_POLL = 3;

export const DEFAULT_TICKET_QUEUE_FINAL_GATES = [
  { label: "test", command: "bun", args: ["run", "test"] },
  { label: "typecheck", command: "bun", args: ["run", "typecheck"] },
  { label: "biome", command: "bunx", args: ["biome", "check", "."] },
] as const satisfies readonly FinalGateCommand[];

export type TicketQueueBootstrapOptions = {
  readonly address: string;
  readonly namespace: string;
  readonly taskQueue: string;
  readonly repoRoot: string;
  readonly runtimeLogRoot?: string;
};

export type TicketQueueBootstrapResult = {
  readonly workflowId: typeof TICKET_QUEUE_WORKFLOW_ID;
  readonly taskQueue: string;
  readonly namespace: string;
};

export type TicketQueueWorkflowStartClient = {
  readonly workflow: {
    start(
      workflow: typeof ticketQueueWorkflow | typeof mergeQueueWorkflow,
      options: {
        readonly workflowId: typeof TICKET_QUEUE_WORKFLOW_ID | typeof MERGE_QUEUE_WORKFLOW_ID;
        readonly workflowIdConflictPolicy: WorkflowIdConflictPolicy;
        readonly taskQueue: string;
        readonly args: readonly [TicketQueueWorkflowInput | MergeQueueWorkflowInput];
      },
    ): Promise<unknown>;
    getHandle(workflowId: string): {
      signal?(signal: typeof enqueueMergeSignal, request: MergeQueueRequest): Promise<unknown>;
      signal?(
        signal: typeof updateTicketQueueConfigSignal,
        config: TicketQueueConfig,
      ): Promise<unknown>;
      terminate(reason?: string): Promise<unknown>;
    };
  };
};

export type VerifiedMergeQueueReader = () => Promise<readonly VerifiedMergeQueueTicket[]>;

export function defaultTicketQueueBootstrapOptions(): TicketQueueBootstrapOptions {
  return {
    address: Bun.env.TEMPORAL_ADDRESS ?? "127.0.0.1:7233",
    namespace: Bun.env.TEMPORAL_NAMESPACE ?? "project-management",
    taskQueue: Bun.env.TEMPORAL_TASK_QUEUE ?? TICKET_QUEUE_TASK_QUEUE,
    repoRoot: Bun.env.REPO_ROOT ?? new URL("../../..", import.meta.url).pathname,
  };
}

export async function ensureTicketQueueWorkflow(
  options = defaultTicketQueueBootstrapOptions(),
): Promise<TicketQueueBootstrapResult> {
  const connection = await Connection.connect({ address: options.address });
  const client = new Client({ connection, namespace: options.namespace });
  await ensureTicketQueueWorkflowWithClient(client, options);

  return {
    workflowId: TICKET_QUEUE_WORKFLOW_ID,
    taskQueue: options.taskQueue,
    namespace: options.namespace,
  };
}

export async function ensureTicketQueueWorkflowWithClient(
  client: TicketQueueWorkflowStartClient,
  options: Omit<TicketQueueBootstrapOptions, "address" | "namespace">,
  readVerifiedTickets: VerifiedMergeQueueReader = () =>
    readVerifiedMergeQueue({ repoRoot: options.repoRoot }, runCommand),
): Promise<void> {
  const input: TicketQueueWorkflowInput = {
    repoRoot: options.repoRoot,
    finalGates: DEFAULT_TICKET_QUEUE_FINAL_GATES,
    runtimeLogRoot: options.runtimeLogRoot ?? defaultRuntimeLogRoot(),
    baseRef: "HEAD",
    requirePushedBranch: true,
    pollIntervalMs: 15_000,
    maxActiveTicketWorkflows: DEFAULT_MAX_ACTIVE_TICKET_WORKFLOWS,
    maxTicketsPerPoll: DEFAULT_MAX_TICKETS_PER_POLL,
  };

  await client.workflow.start(ticketQueueWorkflow, {
    workflowId: TICKET_QUEUE_WORKFLOW_ID,
    workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
    taskQueue: options.taskQueue,
    args: [input],
  });
  await signalTicketQueueConfig(client, {
    maxActiveTicketWorkflows: DEFAULT_MAX_ACTIVE_TICKET_WORKFLOWS,
    maxTicketsPerPoll: DEFAULT_MAX_TICKETS_PER_POLL,
  });
  await client.workflow.start(mergeQueueWorkflow, {
    workflowId: MERGE_QUEUE_WORKFLOW_ID,
    workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
    taskQueue: options.taskQueue,
    args: [
      {
        repoRoot: options.repoRoot,
        taskQueue: options.taskQueue,
        finalGates: DEFAULT_TICKET_QUEUE_FINAL_GATES,
        runtimeLogRoot: options.runtimeLogRoot ?? defaultRuntimeLogRoot(),
        maxMergeAttempts: 3,
        maxHistoryEvents: 100,
      },
    ],
  });
  await reconcileVerifiedTicketsWithMergeQueue(client, options, await readVerifiedTickets());
  await terminateLegacyTicketQueueWorkflow(client);
}

async function signalTicketQueueConfig(
  client: TicketQueueWorkflowStartClient,
  config: TicketQueueConfig,
): Promise<void> {
  const handle = client.workflow.getHandle(TICKET_QUEUE_WORKFLOW_ID);
  if (!handle.signal) return;
  await handle.signal(updateTicketQueueConfigSignal, config);
}

export async function reconcileVerifiedTicketsWithMergeQueue(
  client: TicketQueueWorkflowStartClient,
  options: Pick<TicketQueueBootstrapOptions, "runtimeLogRoot">,
  tickets: readonly VerifiedMergeQueueTicket[],
): Promise<void> {
  const handle = client.workflow.getHandle(MERGE_QUEUE_WORKFLOW_ID);
  if (!handle.signal) return;
  for (const ticket of tickets) {
    await handle.signal(enqueueMergeSignal, mergeQueueRequestFromVerifiedTicket(ticket, options));
  }
}

export function mergeQueueRequestFromVerifiedTicket(
  ticket: VerifiedMergeQueueTicket,
  options: Pick<TicketQueueBootstrapOptions, "runtimeLogRoot">,
): MergeQueueRequest {
  return {
    requestId: mergeQueueRequestId(ticket.ticketId, ticket.commitSha),
    ticketId: ticket.ticketId,
    ticketWorkflowId: `ticket_${ticket.ticketId}`,
    title: ticket.title,
    branch: ticket.branch,
    commitSha: ticket.commitSha,
    strategy: "merge",
    acceptanceCriteria: ticket.acceptanceCriteria,
    comments: ticket.comments,
    requestedAt: new Date(0).toISOString(),
    runtimeLogRoot: options.runtimeLogRoot,
  };
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
