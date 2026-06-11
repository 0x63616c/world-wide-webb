// The k8s Provider + shared namespace for the control-center cluster stack
// (CC-j934.4 onward). The provider targets the OrbStack single-node cluster via
// its kubeconfig context `orbstack` (set up in Phase 0). Passing the provider in
// as an INPUT to every component (Workload, ESO, CNPG, …) keeps the vocabulary
// cluster-agnostic, so a future Hetzner cluster is a provider swap, not a
// rewrite (RECON decision 13 / DESIGN section 1).

import * as k8s from "@pulumi/kubernetes";

// The app namespace every control-center workload + its synced Secrets live in.
export const APP_NAMESPACE = "control-center";

// The kubeconfig context for the OrbStack cluster on homelab.
const ORBSTACK_CONTEXT = "orbstack";

export interface ClusterResources {
  provider: k8s.Provider;
  namespace: k8s.core.v1.Namespace;
}

/**
 * @public - the cluster provider + app namespace, the shared base every Phase-3
 * component builds on. `context` overridable for tests / a future cluster.
 */
// Pin the k8s provider PLUGIN version so a future `pulumi up` can't auto-pull a
// newer plugin that drifts from the @pulumi/kubernetes SDK schema and forces
// state surgery (the v5/v6 footgun, [[pulumi-cloudflare-v5-v6-import-pin]]).
// Matches package.json ^4.21.0. CNPG + cert-manager ride this same provider
// (they install via ConfigFile/Helm), so this pin covers them too.
const K8S_PLUGIN_VERSION = "4.21.0";

export function makeCluster(context: string = ORBSTACK_CONTEXT): ClusterResources {
  const provider = new k8s.Provider("orbstack", { context }, { version: K8S_PLUGIN_VERSION });
  const namespace = new k8s.core.v1.Namespace(
    APP_NAMESPACE,
    { metadata: { name: APP_NAMESPACE } },
    { provider },
  );
  return { provider, namespace };
}
