import type { SecretProvider } from "./interface.ts";

// Reads a secret from a named environment variable.
// Ref format: env://VAR_NAME
// An explicit env map is accepted so tests don't pollute process.env and
// runtime code passes process.env directly.
export class EnvProvider implements SecretProvider {
  private readonly env: Record<string, string | undefined>;

  constructor(env: Record<string, string | undefined>) {
    this.env = env;
  }

  async resolve(ref: string): Promise<string> {
    const name = ref.replace(/^env:\/\//, "");
    const value = this.env[name];
    if (value === undefined) {
      throw new Error(`env var ${name} not set`);
    }
    return value;
  }
}
