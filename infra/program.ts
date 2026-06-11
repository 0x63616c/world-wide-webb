// Pulumi program for the control-center k3s cluster stack (www-j934.4 onward).
//
// Wires the cluster provider + namespace and the External Secrets Operator with
// the 1Password SDK provider (www-j934.4): one ClusterSecretStore + one
// ExternalSecret per service, syncing op://Homelab fields into k8s Secrets the
// Deployments mount at /run/secrets/<NAME>. CNPG + cert-manager (www-j934.5), the
// app Workloads (www-j934.6), and the CronJobs (www-j934.7) extend this program in
// their own commits.
//
// Bootstrap (out-of-band, once): the 1P service-account token Secret
// `op-service-account` in the external-secrets namespace, seeded by
// scripts/seed-op-service-account.sh. Never committed.

import { APP_NAMESPACE, makeCluster } from "./src/cluster.ts";
import { installEso } from "./src/eso.ts";

const cluster = makeCluster();

const eso = installEso({
  provider: cluster.provider,
  appNamespace: APP_NAMESPACE,
  chartVersion: "2.6.0",
});

// Surface ESO resource names (not values) for the Phase-3 SecretSynced check.
export const externalSecretNames = eso.externalSecrets.map((e) => e.metadata.name);
export const appNamespaceName = cluster.namespace.metadata.name;
