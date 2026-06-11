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

import * as pulumi from "@pulumi/pulumi";
import { installCertManager } from "./src/certmanager.ts";
import { APP_NAMESPACE, makeCluster } from "./src/cluster.ts";
import { installCnpg } from "./src/cnpg.ts";
import { installEso } from "./src/eso.ts";

const cfg = new pulumi.Config("ccinfra");
const cluster = makeCluster();

const eso = installEso({
  provider: cluster.provider,
  appNamespace: APP_NAMESPACE,
  chartVersion: "2.6.0",
});

// CNPG operator + the single-instance control-center Cluster (www-j934.5). The
// auth ExternalSecret depends on ESO's store being up, so order after eso.
const cnpg = installCnpg({
  provider: cluster.provider,
  namespace: APP_NAMESPACE,
  operatorVersion: "1.29.1",
});

// cert-manager + CF DNS-01 ClusterIssuer + portal TLS Certificate (www-j934.5).
const certManager = installCertManager({
  provider: cluster.provider,
  namespace: APP_NAMESPACE,
  acmeEmail: cfg.get("acmeEmail"),
  version: "v1.20.2",
});

// Surface resource names (not values) for the Phase-3 acceptance checks.
export const externalSecretNames = eso.externalSecrets.map((e) => e.metadata.name);
export const appNamespaceName = cluster.namespace.metadata.name;
export const cnpgClusterName = cnpg.cluster.metadata.name;
export const portalCertificateName = certManager.certificate.metadata.name;
