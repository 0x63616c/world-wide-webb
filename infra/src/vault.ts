// Decrypt-in-Pulumi vault reader (CC-k8t7). Replaces ESO+1Password SDK with
// SOPS+age: vault is decrypted once per deploy, values wrapped in pulumi.secret().
//
// Local `pulumi up`: age key from macOS Keychain (no env setup needed).
// CI `pulumi up`: SOPS_AGE_KEY injected by the deploy job from AGE_PRIVATE_KEY secret.

import { execSync } from "node:child_process";
import * as pulumi from "@pulumi/pulumi";
import * as yaml from "yaml";
import type { ServiceSecrets } from "./secrets-map.ts";
import { SERVICE_SECRETS } from "./secrets-map.ts";

/** @public */
export function loadVault(): Record<string, string> {
  // biome-ignore lint/style/noProcessEnv: Pulumi program; env is the only channel for AGE key injection
  let ageKey = process.env.SOPS_AGE_KEY;
  if (!ageKey) {
    ageKey = execSync(
      // biome-ignore lint/style/noProcessEnv: USER is a standard POSIX env var, always set
      `security find-generic-password -a "${process.env.USER}" -s "age-world-wide-webb-private-key" -w`,
      { encoding: "utf8" },
    ).trim();
    // biome-ignore lint/style/noProcessEnv: propagate key for sops child process
    process.env.SOPS_AGE_KEY = ageKey;
  }

  const vaultPath = new URL("../../secrets/vault.yaml", import.meta.url).pathname;
  const plaintext = execSync(`sops -d "${vaultPath}"`, { encoding: "utf8" });
  return yaml.parse(plaintext) as Record<string, string>;
}

/** @public */
export function serviceSecretData(
  service: string,
  vault: Record<string, string>,
): Record<string, pulumi.Output<string>> {
  const secrets: ServiceSecrets = SERVICE_SECRETS[service] ?? {};
  return Object.fromEntries(
    Object.entries(secrets).map(([envName, vaultKey]) => {
      const value = vault[vaultKey];
      if (value === undefined) {
        throw new Error(
          `vault.ts: vault key "${vaultKey}" not found (needed by ${service}/${envName})`,
        );
      }
      return [envName, pulumi.secret(value)];
    }),
  );
}
