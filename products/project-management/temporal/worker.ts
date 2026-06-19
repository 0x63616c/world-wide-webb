import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities";
import * as agentActivities from "./agent-activities";
import * as commandActivities from "./command-activities";
import { ensureTicketQueueWorkflow } from "./queue-bootstrap";

const TASK_QUEUE = "project-management";

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

async function waitForTemporal(address: string, timeoutMs: number): Promise<void> {
  const [hostname, portText] = address.split(":");
  const port = Number(portText);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const socket = await Bun.connect({ hostname, port, socket: {} });
      socket.end();
      return;
    } catch {
      await Bun.sleep(250);
    }
  }

  throw new Error(`Timed out waiting for Temporal at ${address}`);
}

export async function runTemporalWorker(options = defaultTemporalWorkerOptions()): Promise<void> {
  await waitForTemporal(options.address, 30_000);

  const connection = await NativeConnection.connect({ address: options.address });
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

  await ensureTicketQueueWorkflow({
    address: options.address,
    namespace: options.namespace,
    taskQueue: options.taskQueue,
    repoRoot: Bun.env.REPO_ROOT ?? new URL("../../..", import.meta.url).pathname,
  });

  const healthServer = startHealthServer(options);

  try {
    await worker.run();
  } finally {
    healthServer.stop();
  }
}

if (import.meta.main) await runTemporalWorker();
