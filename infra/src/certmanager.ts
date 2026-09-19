// cert-manager + a Cloudflare DNS-01 ClusterIssuer (www-j934.5). DNS-01 via
// Cloudflare is the issuance path: the cluster has no public HTTP-01 surface.
//
// IMPORTANT (www-j934.5 constraint): the DNS-01 challenge writes TXT records at
// runtime via the CF API. Those are cert-manager's business, NOT Pulumi-managed,
// so this module creates ZERO Cloudflare resources in Pulumi state, it can't
// collide with the architect's CF import (.2). The CF API token reaches
// cert-manager through a native k8s Secret built from the SOPS vault
// (CLOUDFLARE_API__CREDENTIAL, the validated account-owned token), never a Pulumi CF resource.

import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

// The Secret holding the CF API token for the DNS-01 solver.
const CF_TOKEN_SECRET = "cloudflare-api-token";
const CF_TOKEN_KEY = "token";
// A ClusterIssuer's solver reads its apiTokenSecretRef from the cert-manager
// CONTROLLER's namespace, NOT the Certificate's namespace. So the CF-token
// Secret must live here, not in the app namespace.
const CERT_MANAGER_NAMESPACE = "cert-manager";
// Let's Encrypt production ACME directory.
const ACME_SERVER = "https://acme-v02.api.letsencrypt.org/directory";

export interface CertManagerArgs {
  provider: k8s.Provider;
  // Optional ACME registration email (a non-secret contact address). Omitted by
  // default: today's acme.sh registers anonymously, and a personal email must
  // not be hardcoded in this public repo (no-personal-email guard). Set via
  // `pulumi config set wwwinfra:acmeEmail` if a contact address is wanted.
  acmeEmail?: string;
  // cert-manager install manifest version (www-j934.4 preflight pin: v1.20.2).
  version: string;
  // Decrypted SOPS vault — provides CLOUDFLARE_API__CREDENTIAL for the DNS-01 solver.
  vault: Record<string, string>;
}

export interface CertManagerResources {
  install: k8s.yaml.ConfigFile;
  cfTokenSecret: k8s.core.v1.Secret;
  issuer: k8s.apiextensions.CustomResource;
}

/**
 * @public - installs cert-manager and the CF DNS-01 ClusterIssuer. Consumed by
 * program.ts. No Certificate is requested here today: the issuer is available
 * for the next workload that needs TLS.
 */
export function installCertManager(args: CertManagerArgs): CertManagerResources {
  const { provider, acmeEmail, version, vault } = args;
  const opts = { provider };

  // cert-manager controller + webhook + cainjector + CRDs, one manifest.
  //
  // Split-horizon DNS fix: the house gateway answers some zone names internally
  // and the in-cluster resolver SERVFAILs the SOA lookup for the public
  // _acme-challenge zone, so cert-manager's DNS-01 propagation self-check never
  // passes. Point that self-check at PUBLIC recursive nameservers (the TXT
  // record itself is published correctly in CF). This is the documented remedy
  // (--dns01-recursive-nameservers-only).
  const install = new k8s.yaml.ConfigFile(
    "cert-manager",
    {
      file: `https://github.com/cert-manager/cert-manager/releases/download/${version}/cert-manager.yaml`,
      transformations: [
        (obj: { kind?: string; metadata?: { name?: string }; spec?: unknown }) => {
          if (obj.kind === "Deployment" && obj.metadata?.name === "cert-manager") {
            const spec = obj.spec as {
              template: { spec: { containers: { args?: string[] }[] } };
            };
            const c = spec.template.spec.containers[0];
            c.args = [
              ...(c.args ?? []),
              "--dns01-recursive-nameservers-only",
              "--dns01-recursive-nameservers=1.1.1.1:53,8.8.8.8:53",
            ];
          }
        },
      ],
    },
    opts,
  );

  // The CF API token for the DNS-01 solver, from the SOPS vault (CC-k8t7).
  // In the cert-manager namespace so the ClusterIssuer's DNS-01 solver can read it.
  const cfTokenSecret = new k8s.core.v1.Secret(
    "cloudflare-api-token",
    {
      metadata: { name: CF_TOKEN_SECRET, namespace: CERT_MANAGER_NAMESPACE },
      stringData: { [CF_TOKEN_KEY]: pulumi.secret(vault.CLOUDFLARE_API__CREDENTIAL) },
    },
    { ...opts, dependsOn: [install] },
  );

  // DNS-01 ClusterIssuer. The solver reads the CF token from the ESO Secret.
  const issuer = new k8s.apiextensions.CustomResource(
    "letsencrypt-dns",
    {
      apiVersion: "cert-manager.io/v1",
      kind: "ClusterIssuer",
      metadata: { name: "letsencrypt-dns" },
      spec: {
        acme: {
          server: ACME_SERVER,
          // Only include email if a contact address was configured (see args).
          ...(acmeEmail ? { email: acmeEmail } : {}),
          privateKeySecretRef: { name: "letsencrypt-dns-account-key" },
          solvers: [
            {
              dns01: {
                cloudflare: {
                  apiTokenSecretRef: { name: CF_TOKEN_SECRET, key: CF_TOKEN_KEY },
                },
              },
            },
          ],
        },
      },
    },
    { ...opts, dependsOn: [install] },
  );

  return { install, cfTokenSecret, issuer };
}
