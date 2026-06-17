// cert-manager + a Cloudflare DNS-01 ClusterIssuer + the portal TLS Certificate
// (www-j934.5). The captive portal is LAN-only, so HTTP-01 can't reach it from
// the ACME server; DNS-01 via Cloudflare is the path (DESIGN section 1).
//
// IMPORTANT (www-j934.5 constraint): the DNS-01 challenge writes TXT records at
// runtime via the CF API. Those are cert-manager's business, NOT Pulumi-managed,
// so this module creates ZERO Cloudflare resources in Pulumi state, it can't
// collide with the architect's CF import (.2). The CF API token reaches
// cert-manager through a native k8s Secret built from the SOPS vault
// (CLOUDFLARE_API__CREDENTIAL, the validated account-owned token), never a Pulumi CF resource.

import * as k8s from "@pulumi/kubernetes";
import type * as pulumi from "@pulumi/pulumi";

// The portal hostnames the Certificate is issued for (LAN-only, never tunneled).
const PORTAL_HOSTS = ["captive-portal.worldwidewebb.co", "app--cp.worldwidewebb.co"] as const;
// The k8s Secret cert-manager mounts the issued cert into; the portal Deployment
// (www-j934.6) mounts the same Secret for its TLS.
const PORTAL_TLS_SECRET = "captive-portal-tls";
// The ESO-synced Secret holding the CF API token for the DNS-01 solver.
const CF_TOKEN_SECRET = "cloudflare-api-token";
const CF_TOKEN_KEY = "token";
// A ClusterIssuer's solver reads its apiTokenSecretRef from the cert-manager
// CONTROLLER's namespace, NOT the Certificate's namespace. So the CF-token
// Secret + its ExternalSecret must live here, not in the app namespace.
const CERT_MANAGER_NAMESPACE = "cert-manager";
// Let's Encrypt production ACME directory.
const ACME_SERVER = "https://acme-v02.api.letsencrypt.org/directory";

export interface CertManagerArgs {
  provider: k8s.Provider;
  // Namespace for the portal Certificate + the CF-token ExternalSecret.
  namespace: pulumi.Input<string>;
  // Optional ACME registration email (a non-secret contact address). Omitted by
  // default: today's acme.sh registers anonymously, and a personal email must
  // not be hardcoded in this public repo (no-personal-email guard). Set via
  // `pulumi config set wwwinfra:acmeEmail` if a contact address is wanted.
  acmeEmail?: string;
  // cert-manager install manifest version (www-j934.4 preflight pin: v1.20.2).
  version: string;
}

export interface CertManagerResources {
  install: k8s.yaml.ConfigFile;
  cfTokenSecret: k8s.apiextensions.CustomResource;
  issuer: k8s.apiextensions.CustomResource;
  certificate: k8s.apiextensions.CustomResource;
}

/**
 * @public - installs cert-manager, the CF DNS-01 ClusterIssuer, and the portal
 * Certificate. The portal Deployment (www-j934.6) mounts PORTAL_TLS_SECRET. No
 * internal consumer in this ticket yet.
 */
export function installCertManager(args: CertManagerArgs): CertManagerResources {
  const { provider, namespace, acmeEmail, version } = args;
  const opts = { provider };

  // cert-manager controller + webhook + cainjector + CRDs, one manifest.
  //
  // Split-horizon DNS fix: the UniFi gateway answers captive-portal.worldwidewebb.co
  // internally (-> .147), and the in-cluster resolver SERVFAILs the SOA lookup for
  // the public _acme-challenge zone, so cert-manager's DNS-01 propagation
  // self-check never passes. Point that self-check at PUBLIC recursive
  // nameservers (the TXT record itself is published correctly in CF). This is the
  // documented remedy (--dns01-recursive-nameservers-only).
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

  // The CF API token for the DNS-01 solver, synced by ESO (NOT a Pulumi CF
  // resource). Account-owned token, already validated (Zone.DNS:Edit +
  // Zone.Zone:Read covered).
  const cfTokenSecret = new k8s.apiextensions.CustomResource(
    "es-cloudflare-token",
    {
      apiVersion: "external-secrets.io/v1",
      kind: "ExternalSecret",
      // In the cert-manager namespace, NOT the app namespace, so the
      // ClusterIssuer's DNS-01 solver can read it (see CERT_MANAGER_NAMESPACE).
      metadata: { name: "es-cloudflare-token", namespace: CERT_MANAGER_NAMESPACE },
      spec: {
        refreshInterval: "1h",
        secretStoreRef: { kind: "ClusterSecretStore", name: "onepassword" },
        target: { name: CF_TOKEN_SECRET, creationPolicy: "Owner" },
        data: [{ secretKey: CF_TOKEN_KEY, remoteRef: { key: "Cloudflare API/credential" } }],
      },
    },
    // The cert-manager namespace is created by the install manifest.
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

  // The portal Certificate. cert-manager solves DNS-01, then writes the cert +
  // key into PORTAL_TLS_SECRET; the portal Deployment mounts it (www-j934.6).
  const certificate = new k8s.apiextensions.CustomResource(
    "captive-portal-tls",
    {
      apiVersion: "cert-manager.io/v1",
      kind: "Certificate",
      metadata: { name: "captive-portal-tls", namespace },
      spec: {
        secretName: PORTAL_TLS_SECRET,
        dnsNames: [...PORTAL_HOSTS],
        issuerRef: { name: "letsencrypt-dns", kind: "ClusterIssuer" },
      },
    },
    { ...opts, dependsOn: [issuer, cfTokenSecret] },
  );

  return { install, cfTokenSecret, issuer, certificate };
}
