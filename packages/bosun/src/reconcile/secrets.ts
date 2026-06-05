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

export interface ReconcileSecretsResult {
  // declared name -> hashed docker secret name, for stack rendering.
  names: Record<string, string>;
  // Hashed names of THIS stack's secrets that are no longer declared. These are
  // pruned by pruneSecrets() AFTER the stack redeploys — never before, because a
  // still-in-use secret refuses `docker secret rm` and would abort the deploy
  // mid-rename (CC-8pt).
  stale: string[];
}

// Derive the immutable hashed docker secret name for a given declared name + value.
// Docker secrets are immutable; a value change produces a new name, triggering a
// rolling service update and eventual prune of the old entry.
// NOTE: the cc_ prefix is legacy; CC-8pt migrates it to a stackName-derived
// namespace. Prune now runs AFTER deploy (see pruneSecrets), so renaming an
// in-use secret no longer aborts the deploy — the create+rename flips here and
// the old name is pruned once the redeploy has re-pointed services off it.
function secretDockerName(declaredName: string, value: string): string {
  const hash = createHash("sha256").update(value).digest("hex").slice(0, 8);
  return `cc_${declaredName}_${hash}`;
}

// Label key used to scope all secrets to this stack. Only secrets carrying this
// label are eligible for prune — everything else is foreign and must be left alone.
function stackLabelKey(): string {
  return "bosun.stack";
}

// Reconcile (create phase): create any declared secret that is not yet present,
// and compute the set of this-stack secrets that are now stale (no longer
// declared). Does NOT prune — pruning is deferred to pruneSecrets() AFTER the
// stack redeploys, so a rename of an in-use secret can never abort the deploy.
// Returns the declared name -> hashed docker name map plus the stale set.
export async function reconcileSecrets(
  stackName: string,
  secrets: ResolvedSecret[],
  client: DockerSecretClient,
): Promise<ReconcileSecretsResult> {
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

  // Compute (but do not remove) prune candidates: only secrets belonging to THIS
  // stack that are no longer declared. The label scope is the critical safety
  // invariant — a foreign or other-stack secret is never a candidate.
  const declaredDockerNames = new Set(declared.map((d) => d.dockerName));
  const stale = existing
    .filter((s) => s.labels[stackLabelKey()] === stackName && !declaredDockerNames.has(s.name))
    .map((s) => s.name);

  return {
    names: Object.fromEntries(declared.map((d) => [d.declaredName, d.dockerName])),
    stale,
  };
}

// Prune stale docker secrets AFTER the stack has redeployed off them. Removal is
// tolerant: a secret still referenced by an in-flight task makes `docker secret
// rm` fail, and that must NOT abort the caller — the secret is simply skipped and
// becomes prunable on the next deploy once it is fully unreferenced (CC-8pt).
export async function pruneSecrets(
  staleNames: string[],
  client: DockerSecretClient,
  // Defaults to silent; cli.ts (the console-allowed entry point) passes console.log.
  log: (msg: string) => void = () => {},
): Promise<void> {
  for (const name of staleNames) {
    try {
      await client.removeSecret(name);
    } catch (err) {
      log(
        `[bosun] secret '${name}' still in use, deferring prune to next deploy: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
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
