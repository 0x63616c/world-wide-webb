import type { Logger } from "@repo/logger";
import type { SecretProvider } from "./interface.ts";

// Exec dependency injected so tests can mock without spawning a real op process.
type Exec = (cmd: string) => Promise<{ stdout: string; stderr: string }>;

// A no-op fallback so the OpProvider works in tests without a real logger.
const NOOP_LOGGER: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
} as unknown as Logger;

// Delegates to the `op read` CLI. Requires an active op session (or a
// service-account token in OP_SERVICE_ACCOUNT_TOKEN) on the calling machine.
export class OpProvider implements SecretProvider {
  private readonly exec: Exec;
  private readonly log: Logger;
  // Serialization queue (CC-ykj). Callers resolve many refs concurrently
  // (cmdUp does `Promise.all(refs.map(resolve))`), but concurrent `op read`
  // processes race on op's daemon/config initialisation on a fresh container
  // and corrupt ~/.config/op/config ("invalid JSON: unexpected end of JSON
  // input"), aborting the deploy. Chaining each read after the previous keeps
  // op invocations strictly sequential: the first read inits the daemon alone,
  // the rest reuse it. Instance-scoped, so it is not a module-global.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(exec: Exec, log: Logger = NOOP_LOGGER) {
    this.exec = exec;
    this.log = log;
  }

  resolve(ref: string): Promise<string> {
    const run = this.queue.then(() => this.read(ref));
    // Keep the chain alive regardless of this read's outcome so one failed read
    // does not wedge the queue for the reads behind it.
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async read(ref: string): Promise<string> {
    // Quote the reference: op:// item names legitimately contain spaces
    // (e.g. "WiFi Guest Credentials"), and exec runs via a shell, so an
    // unquoted ref would be split into multiple argv entries.
    const t0 = Date.now();
    const { stdout, stderr } = await this.exec(`op read "${ref}"`);
    const durationMs = Date.now() - t0;
    if (stderr.trim()) {
      // Log the ref path so the failed read is traceable; NEVER log the value.
      this.log.error({ ref, durationMs }, "op read failed");
      throw new Error(`op read failed: ${stderr.trim()}`);
    }
    // Debug: per-ref path + timing so an operator can spot a slow vault read.
    // The value is not logged — only the ref path (the op:// URI is not a secret).
    this.log.debug({ ref, durationMs }, "op read ok");
    return stdout.trim();
  }
}

// Default exec implementation using Node's child_process, used at runtime.
export async function makeDefaultExec(): Promise<Exec> {
  const { exec } = await import("node:child_process");
  const { promisify } = await import("node:util");
  return promisify(exec) as Exec;
}
