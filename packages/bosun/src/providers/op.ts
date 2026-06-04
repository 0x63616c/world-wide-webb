import type { SecretProvider } from "./interface.ts";

// Exec dependency injected so tests can mock without spawning a real op process.
type Exec = (cmd: string) => Promise<{ stdout: string; stderr: string }>;

// Delegates to the `op read` CLI. Requires an active op session (or a
// service-account token in OP_SERVICE_ACCOUNT_TOKEN) on the calling machine.
export class OpProvider implements SecretProvider {
  private readonly exec: Exec;

  constructor(exec: Exec) {
    this.exec = exec;
  }

  async resolve(ref: string): Promise<string> {
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
