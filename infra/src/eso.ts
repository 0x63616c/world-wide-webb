// External Secrets Operator + the 1Password SDK provider (CC-j934.4).
//
// ESO syncs each declared op://Homelab field into a native k8s Secret; the
// Deployments (CC-j934.6) mount that Secret as files at /run/secrets/<NAME>,
// byte-identical to today's docker-secret layout, so env.ts needs zero changes.
// The cluster reads 1Password ONCE per refreshInterval (pods read etcd), which
// also fixes the per-deploy op rate-limit churn ([[bosun-agent-op-rate-limit]]).
//
// Bootstrap: the single seed secret is the 1P SERVICE-ACCOUNT token, applied
// out-of-band into Secret `op-service-account` in the external-secrets namespace
// (NEVER committed; see scripts/seed-op-service-account.sh). Everything else
// flows through ESO from there.

import * as k8s from "@pulumi/kubernetes";
import type * as pulumi from "@pulumi/pulumi";
import { SERVICE_SECRETS } from "./secrets-map.ts";

// The 1P vault every ref lives in (the service-account token is scoped to it).
const VAULT = "Homelab";
// The k8s Secret (in the ESO namespace) holding the bootstrap service-account
// token, seeded out-of-band. ESO's ClusterSecretStore reads it.
const BOOTSTRAP_SECRET = "op-service-account";
const BOOTSTRAP_KEY = "token";
// Rotated 1P values propagate within this window without a redeploy (AC).
const REFRESH_INTERVAL = "1h";

export interface EsoArgs {
  provider: k8s.Provider;
  // Namespace the ExternalSecrets + synced Secrets land in (the app namespace).
  appNamespace: pulumi.Input<string>;
  // Pin the ESO Helm chart version (CC-j934.4 preflight: chart 2.6.0).
  chartVersion: string;
}

export interface EsoResources {
  release: k8s.helm.v3.Release;
  store: k8s.apiextensions.CustomResource;
  externalSecrets: k8s.apiextensions.CustomResource[];
}

/**
 * @public - installs ESO, wires the 1P SDK ClusterSecretStore, and emits one
 * ExternalSecret per service (from SERVICE_SECRETS). Consumed by the cluster
 * program (CC-j934.6); no internal consumer in this ESO ticket yet.
 */
export function installEso(args: EsoArgs): EsoResources {
  const { provider, appNamespace, chartVersion } = args;
  const opts = { provider };

  // The external-secrets namespace is created + owned by the seed step
  // (scripts/seed-op-service-account.sh) because the bootstrap token Secret must
  // exist there BEFORE this program runs. We reference it by name rather than
  // declare it, so the two don't fight over ownership.
  const esoNamespaceName = "external-secrets";

  // ESO operator + CRDs. createNamespace:false (the seed owns it); installCRDs so
  // the ClusterSecretStore/ExternalSecret CRDs exist before we declare them
  // (Pulumi orders via dependsOn below).
  const release = new k8s.helm.v3.Release(
    "external-secrets",
    {
      chart: "external-secrets",
      version: chartVersion,
      namespace: esoNamespaceName,
      createNamespace: false,
      repositoryOpts: { repo: "https://charts.external-secrets.io" },
      values: {
        installCRDs: true,
        // 8GB node: keep the footprint small, no extra webhooks/metrics stacks.
        replicaCount: 1,
        resources: { requests: { cpu: "25m", memory: "96Mi" }, limits: { memory: "192Mi" } },
        webhook: {
          resources: { requests: { cpu: "10m", memory: "32Mi" }, limits: { memory: "96Mi" } },
        },
        certController: {
          resources: { requests: { cpu: "10m", memory: "32Mi" }, limits: { memory: "96Mi" } },
        },
      },
    },
    opts,
  );

  // The 1P SDK ClusterSecretStore, authenticated by the bootstrap service-account
  // token Secret. Cluster-scoped so every namespace's ExternalSecrets can use it.
  const store = new k8s.apiextensions.CustomResource(
    "onepassword",
    {
      apiVersion: "external-secrets.io/v1",
      kind: "ClusterSecretStore",
      metadata: { name: "onepassword" },
      spec: {
        provider: {
          onepasswordSDK: {
            vault: VAULT,
            auth: {
              serviceAccountSecretRef: {
                name: BOOTSTRAP_SECRET,
                key: BOOTSTRAP_KEY,
                namespace: esoNamespaceName,
              },
            },
          },
        },
      },
    },
    { ...opts, dependsOn: [release] },
  );

  // One ExternalSecret per service: each maps env-name -> op://Homelab/Item/field
  // into a single Secret named cc-secrets-<service>, whose keys become the files
  // under /run/secrets/<NAME> when mounted (CC-j934.6).
  const externalSecrets = Object.entries(SERVICE_SECRETS).map(([service, secrets]) => {
    const data = Object.entries(secrets).map(([envName, itemField]) => ({
      secretKey: envName,
      remoteRef: { key: itemField },
    }));
    return new k8s.apiextensions.CustomResource(
      `es-${service}`,
      {
        apiVersion: "external-secrets.io/v1",
        kind: "ExternalSecret",
        metadata: { name: `cc-secrets-${service}`, namespace: appNamespace },
        spec: {
          refreshInterval: REFRESH_INTERVAL,
          secretStoreRef: { kind: "ClusterSecretStore", name: "onepassword" },
          target: { name: `cc-secrets-${service}`, creationPolicy: "Owner" },
          data,
        },
      },
      { ...opts, dependsOn: [store] },
    );
  });

  return { release, store, externalSecrets };
}
