// Native k8s Secrets per workload (CC-k8t7: replaces ESO+1Password with
// decrypt-in-Pulumi from secrets/vault.yaml). One Secret per SERVICE_SECRETS
// entry, same names as before (cc-secrets-<service>) so the /run/secrets/<NAME>
// mount contract in component.ts is untouched.

import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import type { ServiceSecrets } from "./secrets-map.ts";
import { SERVICE_SECRETS } from "./secrets-map.ts";

export interface SecretsArgs {
  provider: k8s.Provider;
  appNamespace: pulumi.Input<string>;
  vault: Record<string, string>;
}

export interface SecretsResources {
  // Kept for program.ts export compat; each entry is a native Secret, not an ExternalSecret.
  externalSecrets: k8s.core.v1.Secret[];
}

function createServiceSecret(
  service: string,
  secrets: ServiceSecrets,
  vault: Record<string, string>,
  namespace: pulumi.Input<string>,
  opts: pulumi.CustomResourceOptions,
): k8s.core.v1.Secret {
  const stringData: Record<string, pulumi.Output<string>> = {};
  for (const [envName, vaultKey] of Object.entries(secrets)) {
    const value = vault[vaultKey];
    if (value === undefined) {
      throw new Error(`vault key "${vaultKey}" not found (needed by ${service}/${envName})`);
    }
    stringData[envName] = pulumi.secret(value);
  }

  return new k8s.core.v1.Secret(
    `cc-secrets-${service}`,
    {
      metadata: { name: `cc-secrets-${service}`, namespace },
      stringData,
    },
    opts,
  );
}

/**
 * @public - creates one native k8s Secret per workload from the decrypted SOPS
 * vault. Replaces ESO ExternalSecrets (CC-k8t7). Consumed by the cluster program.
 */
export function installEso(args: SecretsArgs): SecretsResources {
  const { provider, appNamespace, vault } = args;
  const opts = { provider };

  const externalSecrets = Object.entries(SERVICE_SECRETS).map(([service, secrets]) =>
    createServiceSecret(service, secrets, vault, appNamespace, opts),
  );

  return { externalSecrets };
}
