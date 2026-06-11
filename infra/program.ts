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
import { deployServices } from "./src/services.ts";

const cfg = new pulumi.Config("ccinfra");
// kubeContext selects the target cluster. Default cc-homelab (prod, homelab's
// OrbStack reached over the tailnet); a machine-local staging cluster overrides
// it (e.g. `pulumi config set ccinfra:kubeContext orbstack`). www-j934 repoint.
const cluster = makeCluster(cfg.get("kubeContext"));

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

// App workloads (www-j934.6). media-worker replicas: 1 to PROVE it Running +
// NFS-mounted (www-6mz7 un-park), then re-apply at 0 to park it until the
// Phase-4 cutover (Boundary 6, 8GB co-residency with Swarm). Drive via
// `pulumi config set ccinfra:mediaWorkerReplicas 1|0`; default 0 (parked).
// cloudflaredReplicas: 0 for a pre-cutover bring-up so the k3s cloudflared does
// NOT register the live tunnel token alongside Swarm (a prod split-brain); the
// cutover (www-j934.9 / DESIGN §7 step 3) flips it to 2 (HA) as Swarm comes down.
// Drive via `pulumi config set ccinfra:cloudflaredReplicas 0|2`; default 2.
// nasNfsServer defaults to the NAS LAN IP. The NFS PV is mounted by KUBELET in
// the node netns, which on homelab (the prod target) reaches the home LAN
// directly (DESIGN 5b spike). The pod-egress no-route limitation (DESIGN 5c)
// does NOT apply to PV mounts. Overridable only if a node ever needs a different
// path to the NAS (www-j934.17).
const services = deployServices({
  provider: cluster.provider,
  namespace: APP_NAMESPACE,
  mediaWorkerReplicas: cfg.getNumber("mediaWorkerReplicas") ?? 0,
  cloudflaredReplicas: cfg.getNumber("cloudflaredReplicas") ?? 2,
  nasNfsServer: cfg.get("nasNfsServer") ?? "192.168.0.218",
});

// Surface resource names (not values) for the Phase-3 acceptance checks.
export const externalSecretNames = eso.externalSecrets.map((e) => e.metadata.name);
export const appNamespaceName = cluster.namespace.metadata.name;
export const cnpgClusterName = cnpg.cluster.metadata.name;
export const portalCertificateName = certManager.certificate.metadata.name;
export const workloadNames = services.workloads.map((w) => w.deployment.metadata.name);
