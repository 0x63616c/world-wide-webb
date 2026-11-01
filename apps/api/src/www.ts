// Secret hydration must precede feature imports, just as in the legacy API.
import "./boot-env";
import { dirname, resolve } from "node:path";
import { GENERATED_WORKERS } from "@features/_generated/workers.gen";
import { ENV } from "@www/platform/env";
import { createWorkerRuntime } from "@www/worker-runtime";
import { startServer } from "./application";

const cyclesEnabled = ENV.WORKER_CYCLES === "on";

await startServer({
  service: "www",
  staticRoot: import.meta.file.endsWith(".ts")
    ? resolve(import.meta.dir, "../../..")
    : dirname(import.meta.path),
  cycles: (logger) =>
    cyclesEnabled ? createWorkerRuntime([...GENERATED_WORKERS], { logger }) : undefined,
});
