import { GHCR_PULL_SECRET_NAME, GHCR_PULL_SECRET_NAMESPACES } from "./ghcr-pull-secrets.ts";

type KubectlResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type GhcrPullSecretPreflightOptions = {
  context?: string;
};

function kubectl(args: string[]): KubectlResult {
  const proc = Bun.spawnSync(["kubectl", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: proc.exitCode,
    stdout: new TextDecoder().decode(proc.stdout).trim(),
    stderr: new TextDecoder().decode(proc.stderr).trim(),
  };
}

function withContext(args: string[], context?: string): string[] {
  return context ? ["--context", context, ...args] : args;
}

export function verifyLiveGhcrPullSecrets(opts: GhcrPullSecretPreflightOptions = {}): void {
  const failures: string[] = [];
  for (const namespaceName of GHCR_PULL_SECRET_NAMESPACES) {
    const type = kubectl(
      withContext(
        [
          "get",
          "secret",
          GHCR_PULL_SECRET_NAME,
          "--namespace",
          namespaceName,
          "--output",
          "jsonpath={.type}",
        ],
        opts.context,
      ),
    );
    if (type.exitCode !== 0) {
      failures.push(
        `${namespaceName}/${GHCR_PULL_SECRET_NAME}: missing or unreadable (${type.stderr || "kubectl failed"})`,
      );
      continue;
    }
    if (type.stdout !== "kubernetes.io/dockerconfigjson") {
      failures.push(
        `${namespaceName}/${GHCR_PULL_SECRET_NAME}: expected kubernetes.io/dockerconfigjson, got ${type.stdout || "empty"}`,
      );
      continue;
    }

    const config = kubectl(
      withContext(
        [
          "get",
          "secret",
          GHCR_PULL_SECRET_NAME,
          "--namespace",
          namespaceName,
          "--output",
          "jsonpath={.data.\\.dockerconfigjson}",
        ],
        opts.context,
      ),
    );
    if (config.exitCode !== 0 || config.stdout.length === 0) {
      failures.push(`${namespaceName}/${GHCR_PULL_SECRET_NAME}: missing .dockerconfigjson data`);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      [
        "GHCR pull secret preflight failed:",
        ...failures.map((failure) => `- ${failure}`),
        "Recovery: run a targeted Pulumi refresh/up for the missing Secret, then rerun deploy. See docs/deployment-design.md.",
      ].join("\n"),
    );
  }
}
