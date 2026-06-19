import { Client, Connection } from "@temporalio/client";
import { defaultRuntimeLogRoot, type FinalGateCommand } from "./command-activities";
import { type TicketQueueWorkflowInput, ticketQueueWorkflow } from "./workflows";

const TASK_QUEUE = "project-management";
const WORKFLOW_ID = "ticket_queue_main";

const DEFAULT_FINAL_GATES = [
  { label: "test", command: "bun", args: ["run", "test"] },
  { label: "typecheck", command: "bun", args: ["run", "typecheck"] },
  { label: "biome", command: "bunx", args: ["biome", "check", "."] },
] as const satisfies readonly FinalGateCommand[];

async function main(): Promise<void> {
  const address = Bun.env.TEMPORAL_ADDRESS ?? "127.0.0.1:7233";
  const namespace = Bun.env.TEMPORAL_NAMESPACE ?? "project-management";
  const taskQueue = Bun.env.TEMPORAL_TASK_QUEUE ?? TASK_QUEUE;
  const repoRoot = Bun.env.REPO_ROOT ?? new URL("../../..", import.meta.url).pathname;

  const connection = await Connection.connect({ address });
  const client = new Client({ connection, namespace });
  const input: TicketQueueWorkflowInput = {
    repoRoot,
    finalGates: DEFAULT_FINAL_GATES,
    runtimeLogRoot: defaultRuntimeLogRoot(),
    baseRef: "origin/main",
    requirePushedBranch: true,
    pollIntervalMs: 15_000,
  };

  await client.workflow.start(ticketQueueWorkflow, {
    workflowId: WORKFLOW_ID,
    taskQueue,
    args: [input],
  });

  console.warn(
    `[project-management temporal] started ticket queue workflow ${WORKFLOW_ID} namespace=${namespace} taskQueue=${taskQueue}`,
  );
}

if (import.meta.main) await main();
