import type { InfraNamespaceName } from "./cluster.ts";

export const GHCR_PULL_SECRET_NAME = "ghcr-pull";

export const GHCR_PULL_SECRET_NAMESPACES = [
  "control-center",
  "captive-portal",
] as const satisfies readonly InfraNamespaceName[];

export type GhcrPullSecretNamespace = (typeof GHCR_PULL_SECRET_NAMESPACES)[number];

type GhcrPullSecretConsumer = {
  namespaceName: InfraNamespaceName;
  imagePullSecrets?: readonly string[];
};

export function collectGhcrPullSecretNamespaces(
  consumers: readonly GhcrPullSecretConsumer[],
): InfraNamespaceName[] {
  return [
    ...new Set(
      consumers
        .filter((consumer) => consumer.imagePullSecrets?.includes(GHCR_PULL_SECRET_NAME))
        .map((consumer) => consumer.namespaceName),
    ),
  ].sort();
}

export function assertGhcrPullSecretNamespaceCoverage(
  consumers: readonly GhcrPullSecretConsumer[],
): void {
  const expected: InfraNamespaceName[] = [...GHCR_PULL_SECRET_NAMESPACES].sort();
  const actual = collectGhcrPullSecretNamespaces(consumers);
  const missing = actual.filter((namespaceName) => !expected.includes(namespaceName));
  const unused = expected.filter((namespaceName) => !actual.includes(namespaceName));
  if (missing.length > 0 || unused.length > 0) {
    throw new Error(
      [
        "GHCR pull secret namespace list is out of sync with declared GHCR consumers.",
        missing.length > 0 ? `missing from secret list: ${missing.join(", ")}` : undefined,
        unused.length > 0 ? `secret list has no consumer: ${unused.join(", ")}` : undefined,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
}
