// The per-service secret inventory consumed by eso.ts (native k8s Secrets) and
// vault.ts. This file is now a thin ADAPTER: the single declaration lives in the
// @www/platform product manifest (secretCatalog + the per-service secretUsages),
// and the two maps below are DERIVED from it. Each secret value is a VAULT_KEY in
// secrets/vault.yaml (ITEM__FIELD format); vault.ts reads the vault and creates a
// native k8s Secret per service (CC-k8t7: migrated from ESO+1Password to SOPS+age).
//
// Adding/removing a service secret is a one-line edit in the platform manifest;
// SERVICE_SECRETS, SERVICE_SECRET_TARGETS, and the services.ts mount markers all
// follow. infra/test/secrets-derivation.test.ts pins the exact expected content
// as a golden snapshot so any drift fails loudly.

import {
  captivePortalProductManifest,
  controlCenterServiceSecretUsages,
  type ServiceSecretUsage,
  serviceSecretMap,
} from "@www/platform";
import type { InfraNamespaceName } from "./cluster.ts";

/** A service's secret env-name -> VAULT_KEY in secrets/vault.yaml. */
export type ServiceSecrets = Record<string, string>;

// The infra/eso service keys mapped to their platform manifest usage. The
// control-center usage names are 1:1 with the infra keys; the captive-portal
// product API usage is exposed under the `captive-portal-api` eso service key.
// web / storybook / captive-portal(app) have NO secrets and are absent on purpose.
const controlCenterUsages = controlCenterServiceSecretUsages();
const captivePortalUsages = captivePortalProductManifest().secretUsages;

const serviceSecretUsages = {
  api: controlCenterUsages.api,
  worker: controlCenterUsages.worker,
  drizzle: controlCenterUsages.drizzle,
  cloudflared: controlCenterUsages.cloudflared,
  "portal-data-purge": controlCenterUsages["portal-data-purge"],
  "captive-portal-api": captivePortalUsages.api,
} as const satisfies Record<string, ServiceSecretUsage>;

/**
 * @public - the secret inventory per k8s workload, DERIVED from the platform
 * manifest. Consumed by eso.ts to emit one native k8s Secret per service.
 */
export const SERVICE_SECRETS = serviceSecretMap(serviceSecretUsages) satisfies Record<
  string,
  ServiceSecrets
>;

export type ServiceSecretName = keyof typeof serviceSecretUsages;

export type ServiceSecretTarget = Readonly<{
  namespaceName: InfraNamespaceName;
  secretName: string;
}>;

function targetOf(usage: ServiceSecretUsage): ServiceSecretTarget {
  return { namespaceName: usage.namespaceName, secretName: usage.targetSecretName };
}

/**
 * @public - the target namespace + Secret name per workload, DERIVED from the
 * platform manifest usages. Consumed by eso.ts/vault.ts/services.ts/crons.ts.
 */
export const SERVICE_SECRET_TARGETS = {
  api: targetOf(serviceSecretUsages.api),
  worker: targetOf(serviceSecretUsages.worker),
  drizzle: targetOf(serviceSecretUsages.drizzle),
  cloudflared: targetOf(serviceSecretUsages.cloudflared),
  "portal-data-purge": targetOf(serviceSecretUsages["portal-data-purge"]),
  "captive-portal-api": targetOf(serviceSecretUsages["captive-portal-api"]),
} as const satisfies Record<ServiceSecretName, ServiceSecretTarget>;
