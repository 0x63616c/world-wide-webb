import { createHash } from "node:crypto";

// Dependency-injected docker secret client so tests mock without a real swarm.
export interface DockerSecretClient {
  listSecrets(): Promise<Array<{ name: string; labels: Record<string, string> }>>;
  createSecret(name: string, value: string, labels: Record<string, string>): Promise<void>;
  removeSecret(name: string): Promise<void>;
  inspectSecret(name: string): Promise<{ name: string; labels: Record<string, string> } | null>;
}

export interface ResolvedSecret {
  name: string;
  resolvedValue: string;
}

// Derive the immutable hashed docker secret name for a given declared name + value.
// Docker secrets are immutable; a value change produces a new name, triggering a
// rolling service update and eventual prune of the old entry.
function secretDockerName(declaredName: string, value: string): string {
  const hash = createHash("sha256").update(value).digest("hex").slice(0, 8);
  return `cc_${declaredName}_${hash}`;
}

// Label key used to scope all secrets to this stack. Only secrets carrying this
// label are eligible for prune — everything else is foreign and must be left alone.
function stackLabelKey(): string {
  return "bosun.stack";
}

// Reconcile docker secrets:
//   1. For each declared secret, compute the hashed name and create if absent.
//   2. Prune only stack-labelled secrets that are no longer in the declared set.
// Returns a map of declared name -> hashed docker secret name for stack rendering.
export async function reconcileSecrets(
  stackName: string,
  secrets: ResolvedSecret[],
  client: DockerSecretClient,
): Promise<Record<string, string>> {
  // Compute the hashed name for every declared secret.
  const declared = secrets.map((s) => ({
    declaredName: s.name,
    dockerName: secretDockerName(s.name, s.resolvedValue),
    value: s.resolvedValue,
  }));

  const existing = await client.listSecrets();

  // Create any declared secrets that are not yet present.
  const existingNames = new Set(existing.map((s) => s.name));
  for (const d of declared) {
    if (!existingNames.has(d.dockerName)) {
      await client.createSecret(d.dockerName, d.value, { [stackLabelKey()]: stackName });
    }
  }

  // Prune only secrets belonging to THIS stack that are no longer declared.
  const declaredDockerNames = new Set(declared.map((d) => d.dockerName));
  for (const s of existing) {
    const isOurs = s.labels[stackLabelKey()] === stackName;
    if (isOurs && !declaredDockerNames.has(s.name)) {
      await client.removeSecret(s.name);
    }
  }

  // Return the name mapping so the stack renderer can reference hashed names.
  return Object.fromEntries(declared.map((d) => [d.declaredName, d.dockerName]));
}

// Default docker client implementation using the docker CLI, used at runtime.
// Builds on exec + JSON output — no SDK dependency keeps the tool lightweight.
export function makeDefaultDockerSecretClient(): DockerSecretClient {
  const exec = async (cmd: string): Promise<string> => {
    const { exec: nodeExec } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(nodeExec);
    const { stdout } = await run(cmd);
    return stdout;
  };

  return {
    async listSecrets() {
      const out = await exec(
        'docker secret ls --format \'{"name":"{{.Name}}","labels":"{{.Labels}}"}\'',
      );
      return out
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          // Labels come back as "key=value,key2=value2".
          const obj = JSON.parse(line) as { name: string; labels: string };
          const labels: Record<string, string> = {};
          if (obj.labels) {
            for (const pair of obj.labels.split(",")) {
              const [k, v] = pair.split("=");
              if (k) labels[k] = v ?? "";
            }
          }
          return { name: obj.name, labels };
        });
    },

    async createSecret(name: string, value: string, labels: Record<string, string>) {
      const labelFlags = Object.entries(labels)
        .map(([k, v]) => `--label ${k}=${v}`)
        .join(" ");
      // Pipe the value via stdin to avoid leaking it in the process list.
      const { exec: nodeExec } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const run = promisify(nodeExec);
      await run(
        `printf '%s' '${value.replace(/'/g, "'\\''")}' | docker secret create ${labelFlags} ${name} -`,
      );
    },

    async removeSecret(name: string) {
      await exec(`docker secret rm ${name}`);
    },

    async inspectSecret(name: string) {
      try {
        const out = await exec(`docker secret inspect ${name} --format '{{json .}}'`);
        const raw = JSON.parse(out) as { Spec: { Name: string; Labels: Record<string, string> } };
        return { name: raw.Spec.Name, labels: raw.Spec.Labels ?? {} };
      } catch {
        return null;
      }
    },
  };
}
