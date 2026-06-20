import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities";
import * as agentActivities from "./agent-activities";
import * as commandActivities from "./command-activities";
import { ensureTicketQueueWorkflow } from "./queue-bootstrap";

const TASK_QUEUE = "main";

export type TemporalWorkerOptions = {
  readonly address: string;
  readonly namespace: string;
  readonly taskQueue: string;
  readonly healthPort: number;
};

export function defaultTemporalWorkerOptions(): TemporalWorkerOptions {
  return {
    address: Bun.env.TEMPORAL_ADDRESS ?? "127.0.0.1:7233",
    namespace: Bun.env.TEMPORAL_NAMESPACE ?? "project-management",
    taskQueue: Bun.env.TEMPORAL_TASK_QUEUE ?? TASK_QUEUE,
    healthPort: Number(Bun.env.TEMPORAL_WORKER_HEALTH_PORT ?? "8792"),
  };
}

function shouldStartTicketQueue(): boolean {
  return Bun.env.START_TICKET_QUEUE === "1" || Bun.env.START_TICKET_QUEUE === "true";
}

function startHealthServer(options: TemporalWorkerOptions): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: options.healthPort,
    fetch(request) {
      const { pathname } = new URL(request.url);

      if (pathname !== "/health") return new Response("not found", { status: 404 });

      return Response.json({
        ok: true,
        temporalAddress: options.address,
        namespace: options.namespace,
        taskQueue: options.taskQueue,
      });
    },
  });
}

async function connectToTemporal(address: string, timeoutMs: number): Promise<NativeConnection> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      return await NativeConnection.connect({ address });
    } catch (error) {
      lastError = error;
      await Bun.sleep(250);
    }
  }

  throw new Error(`Timed out connecting to Temporal at ${address}`, { cause: lastError });
}

export async function runTemporalWorker(options = defaultTemporalWorkerOptions()): Promise<void> {
  let healthServer: ReturnType<typeof Bun.serve> | undefined;
  try {
    const connection = await connectToTemporal(options.address, 30_000);
    healthServer = startHealthServer(options);
    const worker = await Worker.create({
      connection,
      namespace: options.namespace,
      taskQueue: options.taskQueue,
      workflowsPath: new URL("./workflows.ts", import.meta.url).pathname,
      activities: { ...activities, ...commandActivities, ...agentActivities },
    });

    console.warn(
      `[project-management temporal] worker listening on ${options.address} namespace=${options.namespace} taskQueue=${options.taskQueue}`,
    );

    if (shouldStartTicketQueue()) {
      await ensureTicketQueueWorkflow({
        address: options.address,
        namespace: options.namespace,
        taskQueue: options.taskQueue,
        repoRoot: Bun.env.REPO_ROOT ?? new URL("../../..", import.meta.url).pathname,
      });
    }

    await worker.run();
  } finally {
    healthServer?.stop();
  }
}

if (import.meta.main) await runTemporalWorker();
