import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities";
import * as commandActivities from "./command-activities";

const TASK_QUEUE = "project-management";

export type TemporalWorkerOptions = {
  readonly address: string;
  readonly namespace: string;
  readonly taskQueue: string;
};

export function defaultTemporalWorkerOptions(): TemporalWorkerOptions {
  return {
    address: Bun.env.TEMPORAL_ADDRESS ?? "127.0.0.1:7233",
    namespace: Bun.env.TEMPORAL_NAMESPACE ?? "project-management",
    taskQueue: Bun.env.TEMPORAL_TASK_QUEUE ?? TASK_QUEUE,
  };
}

export async function runTemporalWorker(options = defaultTemporalWorkerOptions()): Promise<void> {
  const connection = await NativeConnection.connect({ address: options.address });
  const worker = await Worker.create({
    connection,
    namespace: options.namespace,
    taskQueue: options.taskQueue,
    workflowsPath: new URL("./workflows.ts", import.meta.url).pathname,
    activities: { ...activities, ...commandActivities },
  });

  console.warn(
    `[project-management temporal] worker listening on ${options.address} namespace=${options.namespace} taskQueue=${options.taskQueue}`,
  );

  await worker.run();
}

if (import.meta.main) await runTemporalWorker();
