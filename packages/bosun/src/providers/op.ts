import type { SecretProvider } from "./interface.ts";

// Exec dependency injected so tests can mock without spawning a real op process.
type Exec = (cmd: string) => Promise<{ stdout: string; stderr: string }>;

// Delegates to the `op read` CLI. Requires an active op session (or a
// service-account token in OP_SERVICE_ACCOUNT_TOKEN) on the calling machine.
export class OpProvider implements SecretProvider {
  private readonly exec: Exec;
  // Serialization queue (CC-ykj). Callers resolve many refs concurrently
  // (cmdUp does `Promise.all(refs.map(resolve))`), but concurrent `op read`
  // processes race on op's daemon/config initialisation on a fresh container
  // and corrupt ~/.config/op/config ("invalid JSON: unexpected end of JSON
  // input"), aborting the deploy. Chaining each read after the previous keeps
  // op invocations strictly sequential: the first read inits the daemon alone,
  // the rest reuse it. Instance-scoped, so it is not a module-global.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(exec: Exec) {
    this.exec = exec;
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
    const { stdout, stderr } = await this.exec(`op read "${ref}"`);
    if (stderr.trim()) {
      throw new Error(`op read failed: ${stderr.trim()}`);
    }
    return stdout.trim();
  }
}

// Default exec implementation using Node's child_process, used at runtime.
export async function makeDefaultExec(): Promise<Exec> {
  const { exec } = await import("node:child_process");
  const { promisify } = await import("node:util");
  return promisify(exec) as Exec;
}
