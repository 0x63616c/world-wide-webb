import { ensureTicketQueueWorkflow } from "./queue-bootstrap";

async function main(): Promise<void> {
  const result = await ensureTicketQueueWorkflow();

  console.warn(
    `[project-management temporal] ensured ticket queue workflow ${result.workflowId} namespace=${result.namespace} taskQueue=${result.taskQueue}`,
  );
}

if (import.meta.main) await main();
