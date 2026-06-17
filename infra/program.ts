// Pulumi program for the control-center k3s cluster stack (CC-k8t7: migrated to
// SOPS+age secrets). Decrypts secrets/vault.yaml once (via vault.ts) and creates
// native k8s Secrets per workload — no ESO, no 1Password SDK, no in-cluster age
// key. The /run/secrets/<NAME> mount contract in component.ts is unchanged.
//
// Local `pulumi up`: age key from macOS Keychain (zero setup).
// CI deploy: SOPS_AGE_KEY injected from AGE_PRIVATE_KEY GitHub secret.

import * as pulumi from "@pulumi/pulumi";
import { installCertManager } from "./src/certmanager.ts";
import { APP_NAMESPACE, makeCluster } from "./src/cluster.ts";
import { installCnpg } from "./src/cnpg.ts";
import { deployCrons } from "./src/crons.ts";
import { installEso } from "./src/eso.ts";
import { deployServices } from "./src/services.ts";
import { loadVault } from "./src/vault.ts";

const cfg = new pulumi.Config("wwwinfra");
// kubeContext selects the target cluster. Default cc-homelab (prod, homelab's
// OrbStack reached over the tailnet); a machine-local staging cluster overrides
// it (e.g. `pulumi config set wwwinfra:kubeContext orbstack`). CI points the
// provider at the context name in its own kubeconfig (the homelab kube-apiserver
// over the tailnet). www-j934 repoint.
const cluster = makeCluster(cfg.get("kubeContext"));

// Decrypt vault once; all secrets flow from this (CC-k8t7).
const vault = loadVault();

// Native k8s Secrets per workload from vault (replaces ESO ExternalSecrets).
const eso = installEso({
  provider: cluster.provider,
  appNamespace: APP_NAMESPACE,
  vault,
});

// CNPG operator + product-owned Postgres Clusters with native basic-auth Secrets.
const cnpg = installCnpg({
  provider: cluster.provider,
  namespace: APP_NAMESPACE,
  operatorVersion: "1.29.1",
  vault,
});

// cert-manager + CF DNS-01 ClusterIssuer + portal TLS Certificate (www-j934.5).
const certManager = installCertManager({
  provider: cluster.provider,
  namespace: APP_NAMESPACE,
  acmeEmail: cfg.get("acmeEmail"),
  version: "v1.20.2",
});

// App workloads (www-j934.6). media-worker replicas: 1 to PROVE it Running +
// NFS-mounted (www-6mz7 un-park), then re-apply at 0 to park it until the
// Phase-4 cutover (Boundary 6, 8GB co-residency with Swarm). Drive via
// `pulumi config set wwwinfra:mediaWorkerReplicas 1|0`; default 0 (parked).
// cloudflaredReplicas: 0 for a pre-cutover bring-up so the k3s cloudflared does
// NOT register the live tunnel token alongside Swarm (a prod split-brain); the
// cutover (www-j934.9 / DESIGN §7 step 3) flips it to 2 (HA) as Swarm comes down.
// Drive via `pulumi config set wwwinfra:cloudflaredReplicas 0|2`; default 2.
// nasNfsServer defaults to the NAS LAN IP. The NFS PV is mounted by KUBELET in
// the node netns, which on homelab (the prod target) reaches the home LAN
// directly (DESIGN 5b spike). The pod-egress no-route limitation (DESIGN 5c)
// does NOT apply to PV mounts. Overridable only if a node ever needs a different
// path to the NAS (www-j934.17).
// imageDigests: per-service image digest pins (name -> "sha256:…"). The CI deploy
// job writes these with `pulumi config set --path imageDigests.<svc>` from the
// freshly built :main manifests, so a `pulumi up` rolls only the workloads whose
// digest changed (the www-czg digest-pin guarantee, now config-driven). Empty in
// local applies, where services fall back to :main.

// The NAS NFS server, shared by the media-worker share and the pg-backup target.
const nasNfsServer = cfg.get("nasNfsServer") ?? "192.168.0.218";

const services = deployServices({
  provider: cluster.provider,
  namespace: APP_NAMESPACE,
  mediaWorkerReplicas: cfg.getNumber("mediaWorkerReplicas") ?? 0,
  cloudflaredReplicas: cfg.getNumber("cloudflaredReplicas") ?? 2,
  // storybook/drizzle default to 0: trimmed 8GB steady-state so the control plane
  // survives a cold reboot (www-j934.9). Both are Access-gated dev tools; bring up
  // on demand via `pulumi config set wwwinfra:storybookReplicas 1` (or drizzle).
  storybookReplicas: cfg.getNumber("storybookReplicas") ?? 0,
  drizzleReplicas: cfg.getNumber("drizzleReplicas") ?? 0,
  nasNfsServer,
  imageDigests: cfg.getObject<Record<string, string>>("imageDigests") ?? {},
  vault,
});

// Scheduled jobs (www-j934.7): portal-data-purge + map-extract re-homed to k8s
// CronJobs, plus product Postgres backups to the NAS. NO docker-image-prune
// (kubelet image GC) and NO portal-cert-renew (cert-manager owns TLS). The
// backup NFS PVs reuse nasNfsServer; the purge job's POSTGRES_PASSWORD comes
// from its ESO Secret (secrets-map.ts), backup creds come from CNPG-managed
// basic-auth Secrets, so order after eso + cnpg.
const crons = deployCrons({
  provider: cluster.provider,
  namespace: APP_NAMESPACE,
  nasNfsServer,
});

// Surface resource names (not values) for the Phase-3 acceptance checks.
export const externalSecretNames = eso.externalSecrets.map((e) => e.metadata.name);
export const appNamespaceName = cluster.namespace.metadata.name;
export const cnpgClusterName = cnpg.cluster.metadata.name;
export const cnpgClusterNames = cnpg.clusters.map((c) => c.metadata.name);
export const cnpgAuthSecretNames = cnpg.authSecrets.map((s) => s.metadata.name);
export const portalCertificateName = certManager.certificate.metadata.name;
export const workloadNames = services.workloads.map((w) => w.deployment.metadata.name);
export const cronJobNames = crons.jobs.map((j) => j.cronJob.metadata.name);
