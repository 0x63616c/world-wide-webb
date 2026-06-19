import { Client, Connection } from "@temporalio/client";
import { WorkflowIdConflictPolicy } from "@temporalio/common";
import { defaultRuntimeLogRoot, type FinalGateCommand } from "./command-activities";
import { type TicketQueueWorkflowInput, ticketQueueWorkflow } from "./workflows";

export const TICKET_QUEUE_WORKFLOW_ID = "ticket_queue";
export const LEGACY_TICKET_QUEUE_WORKFLOW_ID = "ticket_queue_main";
export const TICKET_QUEUE_TASK_QUEUE = "project-management";

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
      workflow: typeof ticketQueueWorkflow,
      options: {
        readonly workflowId: typeof TICKET_QUEUE_WORKFLOW_ID;
        readonly workflowIdConflictPolicy: WorkflowIdConflictPolicy;
        readonly taskQueue: string;
        readonly args: readonly [TicketQueueWorkflowInput];
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
): Promise<void> {
  const input: TicketQueueWorkflowInput = {
    repoRoot: options.repoRoot,
    finalGates: DEFAULT_TICKET_QUEUE_FINAL_GATES,
    runtimeLogRoot: options.runtimeLogRoot ?? defaultRuntimeLogRoot(),
    baseRef: "origin/main",
    requirePushedBranch: true,
    pollIntervalMs: 15_000,
  };

  await client.workflow.start(ticketQueueWorkflow, {
    workflowId: TICKET_QUEUE_WORKFLOW_ID,
    workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
    taskQueue: options.taskQueue,
    args: [input],
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
