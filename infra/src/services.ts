// The control-center app workloads on k3s (www-j934.6): the Pulumi-era successor
// to deploy.config.ts's service() declarations. Each is a WorkloadSpec fed to
// the Workload component; secrets come from the ESO cc-secrets-<name> Secrets
// (www-j934.4), images from GHCR via an imagePullSecret, caps are the www-ke9a
// values verbatim. postgres is CNPG (www-j934.5), not here.
//
// Boundary 6 (8GB, Swarm still runs prod until Phase-4 cutover): media-worker is
// declared replicas 1 so .6 can PROVE it Running + NFS-mounted (www-6mz7 un-park),
// then it's scaled to 0 and parked until cutover. The other 8 stay up.

import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import type { InfraNamespaceName } from "./cluster.ts";
import type { WorkloadSpec } from "./component.ts";
import { ExternalService, Workload } from "./component.ts";

// Per-service GHCR image digest map, name -> "sha256:…", set by the CI deploy job
// (`pulumi config set --path imageDigests.<svc>`). A pinned digest renders the
// image as @sha256:… so only the workloads whose digest changed roll on a
// `pulumi up` (the www-czg digest-pin property, now driven by Pulumi config).
// Empty in local/dev applies, where :main is fine.
export type ImageDigests = Record<string, string>;
export type OwnedWorkloadSpec = WorkloadSpec & { namespaceName: InfraNamespaceName };

// Images that don't follow the default www-cc-<name> prefix.
const IMAGE_REPOSITORIES = {
  "captive-portal": "ghcr.io/0x63616c/www-cp-portal",
  "tye-api": "ghcr.io/0x63616c/www-tye-api",
  "tye-frontend": "ghcr.io/0x63616c/www-tye-web",
  "amp-app": "ghcr.io/0x63616c/www-amp-app",
} as const satisfies Record<string, string>;

// GHCR image ref. Digest-pinned (@sha256:…) when CI supplied a digest for this
// service, else the mutable :main tag (local applies, first deploy before any
// digest is set). The digest is validated shape-wise so a malformed config value
// can't silently produce an unpullable ref.
const ghcr = (name: string, digests: ImageDigests = {}): string => {
  const base =
    IMAGE_REPOSITORIES[name as keyof typeof IMAGE_REPOSITORIES] ??
    `ghcr.io/0x63616c/www-cc-${name}`;
  const digest = digests[name];
  if (digest) {
    if (!/^sha256:[0-9a-f]{64}$/.test(digest)) {
      throw new Error(`imageDigests.${name} is not a sha256:<64-hex> digest: ${digest}`);
    }
    return `${base}@${digest}`;
  }
  return `${base}:main`;
};
// The imagePullSecret name (dockerconfigjson built by ESO from the GHCR token).
const GHCR_PULL_SECRET = "ghcr-pull";
// HA is reached via the host's TAILSCALE FQDN, NOT the LAN IP (www-j934.17):
// OrbStack k8s pods can't route to 192.168.0.0/24 or raw host ports, but the
// Mac locally routes its OWN tailnet IP (utun) to its 0.0.0.0-bound socats, so
// homelab.tail8c014d.ts.net:8123 is delivered to the existing HA socat. The
// `ha` ExternalName Service CNAMEs to this; api/worker keep using http://ha:8123.
const HA_TAILNET_FQDN = "homelab.tail8c014d.ts.net";
const HA_PORT = 8123;

const TZ = "America/Los_Angeles";

// The CNPG read-write Service (www-j934.5) the app connects to. env.ts builds
// DATABASE_URL as postgres://postgres:<pw>@$POSTGRES_HOST:5432/control_center;
// the default host "postgres" was the Swarm service name and does NOT resolve in
// k3s, so set it to the CNPG Service explicitly (a live-deploy finding).
const POSTGRES_HOST = "control-center-rw";

// Shared non-secret env for api + worker (HA reached via the in-cluster `ha`
// Service name now, not host.docker.internal; DB via the CNPG Service).
const haEnv = {
  NODE_ENV: "production",
  APP_ENV: "production",
  TZ,
  HA_URL: `http://ha:${HA_PORT}`,
  UNIFI_CONTROLLER_URL: "https://192.168.0.1",
  POSTGRES_HOST,
};

// secretsFor: a marker list so the Workload mounts cc-secrets-<name>; the actual
// refs live in eso.ts (the ExternalSecrets). We only need a non-empty list here
// to trigger the /run/secrets mount (the render layer reads .length).
const mount = (names: string[]) => names.map((name) => ({ name, ref: "eso" }));

/**
 * Replica/topology knobs the program threads in at apply time.
 * - mediaWorkerReplicas: bring media-worker up briefly (1) to prove it, then
 *   re-apply at 0 (Boundary 6).
 * - cloudflaredReplicas: 0 for a pre-cutover bring-up (so the k3s cloudflared does
 *   NOT grab the live tunnel token and split-brain prod with Swarm), flipped to 2
 *   (HA) at the cutover (www-j934.9 / DESIGN §7 step 3).
 * - nasNfsServer: the NFS server address for the media share, the NAS LAN IP by
 *   default. The PV is mounted by kubelet in the node netns, which on homelab (the
 *   prod target) reaches the home LAN directly (DESIGN 5b); the pod-egress no-route
 *   limit (DESIGN 5c) does not apply to PV mounts. www-j934.17.
 * - imageDigests: CI-supplied digest pin map (name -> sha256:…); absent in local
 *   applies, where every image falls back to the :main tag. www-j934.14.
 * - storybookReplicas / drizzleReplicas: trim knobs for the 8GB steady-state
 *   (www-j934.9). Both are Access-gated internal/dev tools, not prod-critical, so
 *   they default to 0 to leave the control plane ~1-2GB headroom to survive a
 *   cold reboot. Bring either up on demand with `pulumi config set
 *   wwwinfra:<svc>Replicas 1`.
 */
export interface ServiceSpecOptions {
  mediaWorkerReplicas: number;
  cloudflaredReplicas: number;
  storybookReplicas: number;
  drizzleReplicas: number;
  nasNfsServer: string;
  imageDigests?: ImageDigests;
}

/** @public - all app WorkloadSpecs, parameterised by {@link ServiceSpecOptions}. */
export function serviceSpecs(opts: ServiceSpecOptions): OwnedWorkloadSpec[] {
  const {
    mediaWorkerReplicas,
    cloudflaredReplicas,
    storybookReplicas,
    drizzleReplicas,
    nasNfsServer,
    imageDigests: digests = {},
  } = opts;
  return [
    {
      logicalName: "control-center-api",
      name: "api",
      namespaceName: "control-center",
      image: ghcr("api", digests),
      replicas: 1,
      resources: { memory: "512M", reserveCpus: "0.5" },
      secrets: mount([
        "HA_TOKEN",
        "UNIFI_API_KEY",
        "WIFI_SSID",
        "WIFI_PASSWORD",
        "POSTGRES_PASSWORD",
        "HOME_LAT",
        "HOME_LON",
        "HOME_PLACE_NAME",
        "HOME_RADIUS_MILES",
        "SPOTIFY_CLIENT_ID",
        "SPOTIFY_CLIENT_SECRET",
        "SPOTIFY_REFRESH_TOKEN",
      ]),
      env: haEnv,
      ports: [{ containerPort: 4201, expose: "cluster" }],
      imagePullSecrets: [GHCR_PULL_SECRET],
    },
    {
      logicalName: "control-center-worker",
      name: "worker",
      namespaceName: "control-center",
      image: ghcr("worker", digests),
      replicas: 1,
      resources: { memory: "384M" },
      secrets: mount([
        "HA_TOKEN",
        "UNIFI_API_KEY",
        "WIFI_SSID",
        "WIFI_PASSWORD",
        "POSTGRES_PASSWORD",
        "HOME_LAT",
        "HOME_LON",
        "HOME_PLACE_NAME",
        "HOME_RADIUS_MILES",
        "SPOTIFY_CLIENT_ID",
        "SPOTIFY_CLIENT_SECRET",
        "SPOTIFY_REFRESH_TOKEN",
      ]),
      env: haEnv,
      imagePullSecrets: [GHCR_PULL_SECRET],
    },
    {
      logicalName: "control-center-media-worker",
      name: "media-worker",
      namespaceName: "control-center",
      image: ghcr("media-worker", digests),
      replicas: mediaWorkerReplicas,
      resources: { memory: "1G" },
      secrets: mount(["POSTGRES_PASSWORD", "OPENROUTER_API_KEY"]),
      env: { NODE_ENV: "production", APP_ENV: "production", TZ, POSTGRES_HOST },
      // NFS PV for the Synology media share. The DS420+ exports ONLY
      // /volume1/Homelab (not its subdirs), so mount that export and subPath
      // into media/. nfsvers=3 is enforced by the render layer (DS420+ is v3-only).
      volumes: [
        {
          mountPath: "/app/media",
          nfs: { server: nasNfsServer, path: "/volume1/Homelab" },
          subPath: "media",
        },
      ],
      imagePullSecrets: [GHCR_PULL_SECRET],
    },
    {
      logicalName: "control-center-web",
      name: "web",
      namespaceName: "control-center",
      image: ghcr("web", digests),
      replicas: 1,
      resources: { memory: "96M" },
      env: { TZ },
      ports: [{ containerPort: 80, expose: "cluster" }],
      // maps basemap served from a local-path PVC (provisioned by the
      // map-provision init below + refreshed by the map-extract CronJob).
      volumes: [{ mountPath: "/usr/share/nginx/html/maps", claim: "maps", readOnly: true }],
      // Basemap self-provisioning (www-hn1i): runs before nginx in if-missing
      // mode (instant no-op when socal.pmtiles exists), so "the basemap is in
      // the PVC" is a structural precondition of serving, a fresh stack
      // self-heals with zero manual steps (the old suspended-manual-job flow
      // shipped prod with an empty PVC and a blank Tesla map).
      initContainers: [
        {
          name: "map-provision",
          image: ghcr("map-provision", digests),
          command: ["/provision.sh"],
          volumes: [{ mountPath: "/out", claim: "maps" }],
        },
      ],
      imagePullSecrets: [GHCR_PULL_SECRET],
    },
    {
      logicalName: "control-center-storybook",
      name: "storybook",
      namespaceName: "control-center",
      image: ghcr("storybook", digests),
      replicas: storybookReplicas,
      resources: { memory: "96M" },
      env: { TZ },
      ports: [{ containerPort: 6006, expose: "cluster" }],
      imagePullSecrets: [GHCR_PULL_SECRET],
    },
    {
      logicalName: "captive-portal-portal",
      name: "portal",
      namespaceName: "captive-portal",
      image: ghcr("captive-portal", digests),
      replicas: 1,
      resources: { memory: "64M" },
      env: { TZ },
      // LAN LoadBalancer on :443/:80 (republished on en1 by OrbStack expose_services).
      ports: [
        { containerPort: 443, expose: "lan" },
        { containerPort: 80, expose: "lan" },
      ],
      // Mount the cert-manager-issued TLS secret (www-j934.5) for nginx. The
      // secret is kubernetes.io/tls (keys tls.crt/tls.key), but the portal
      // entrypoint + nginx expect the acme.sh filenames fullchain.pem/key.pem on
      // /certs, so project the keys onto those paths (www-j934.20). Without this
      // rename the entrypoint never finds the real cert and stays on its
      // self-signed placeholder.
      extraSecretMounts: [
        {
          secretName: "captive-portal-tls",
          mountPath: "/certs",
          items: [
            { key: "tls.crt", path: "fullchain.pem" },
            { key: "tls.key", path: "key.pem" },
          ],
        },
      ],
      imagePullSecrets: [GHCR_PULL_SECRET],
    },
    {
      logicalName: "control-center-drizzle",
      name: "drizzle",
      namespaceName: "control-center",
      image: ghcr("drizzle", digests),
      replicas: drizzleReplicas,
      resources: { memory: "256M" },
      secrets: mount(["MASTERPASS", "POSTGRES_PASSWORD"]),
      env: { TZ, POSTGRES_HOST },
      ports: [{ containerPort: 4983, expose: "cluster" }],
      volumes: [{ mountPath: "/app", claim: "drizzle-data" }],
      imagePullSecrets: [GHCR_PULL_SECRET],
    },
    {
      logicalName: "amp-app",
      name: "app",
      namespaceName: "amp",
      image: ghcr("amp-app", digests),
      replicas: 1,
      resources: { memory: "64M" },
      env: { TZ },
      ports: [{ containerPort: 80, expose: "cluster" }],
      imagePullSecrets: [GHCR_PULL_SECRET],
    },
    {
      logicalName: "text-your-ex-api",
      name: "api",
      namespaceName: "text-your-ex",
      image: ghcr("tye-api", digests),
      replicas: 1,
      resources: { memory: "256M" },
      secrets: mount(["POSTGRES_PASSWORD"]),
      // secretName defaults to cc-secrets-tye-api (from vault: TEXT_YOUR_EX_POSTGRES__PASSWORD).
      env: {
        TZ,
        APP_ENV: "production",
        NODE_ENV: "production",
        POSTGRES_HOST: "text-your-ex-rw",
        POSTGRES_DB: "text_your_ex",
        POSTGRES_USER: "postgres",
      },
      ports: [{ containerPort: 8787, expose: "cluster" }],
      imagePullSecrets: [GHCR_PULL_SECRET],
    },
    {
      logicalName: "text-your-ex-frontend",
      name: "frontend",
      namespaceName: "text-your-ex",
      image: ghcr("tye-frontend", digests),
      replicas: 1,
      resources: { memory: "64M" },
      env: { TZ },
      ports: [{ containerPort: 80, expose: "cluster" }],
      imagePullSecrets: [GHCR_PULL_SECRET],
    },
    {
      logicalName: "platform-cloudflared",
      name: "cloudflared",
      namespaceName: "platform",
      image: "cloudflare/cloudflared:2025.10.1",
      replicas: cloudflaredReplicas, // HA (2) at cutover; 0 pre-cutover so it
      // does not hold the live tunnel token alongside Swarm (www-j934.9 / §7).
      resources: { memory: "128M", reserveCpus: "0.25" },
      secrets: mount(["TUNNEL_TOKEN"]),
      // k8s `command` REPLACES the image entrypoint (unlike Swarm, which appends
      // to it), so the binary `cloudflared` must lead, then its `tunnel ...` args.
      command: [
        "cloudflared",
        "tunnel",
        "--no-autoupdate",
        "run",
        "--token-file",
        "/run/secrets/TUNNEL_TOKEN",
      ],
      // Public upstream image; no GHCR pull secret.
    },
  ];
}

export interface ServicesArgs {
  provider: k8s.Provider;
  namespaces: Readonly<Record<InfraNamespaceName, pulumi.Input<string>>>;
  // media-worker replicas: 1 to prove, 0 to park (Boundary 6).
  mediaWorkerReplicas: number;
  // cloudflared replicas: 0 for a pre-cutover bring-up (no live-token split with
  // Swarm), 2 (HA) at the cutover (www-j934.9 / DESIGN §7).
  cloudflaredReplicas: number;
  // storybook/drizzle replicas: 0 by default to trim the 8GB steady-state so the
  // control plane survives a cold reboot (www-j934.9); both are Access-gated dev
  // tools, brought up on demand.
  storybookReplicas: number;
  drizzleReplicas: number;
  // NFS server for the media share: NAS LAN IP by default; kubelet mounts the PV
  // from the node netns, which reaches the LAN on homelab (DESIGN 5b/5c, www-j934.17).
  nasNfsServer: string;
  // Per-service image digest pins from CI (name -> sha256:…); see ghcr().
  imageDigests?: ImageDigests;
  // Decrypted vault from vault.ts (CC-k8t7).
  vault: Record<string, string>;
}

export interface ServicesResources {
  ghcrPullSecrets: k8s.core.v1.Secret[];
  haService: ExternalService;
  pvcs: k8s.core.v1.PersistentVolumeClaim[];
  workloads: Workload[];
}

// The local-path PVCs the workloads mount by claim name: drizzle's data dir and
// the web basemap dir (map-extract, .7, writes into `maps`). local-path is the
// OrbStack built-in SSD provisioner (same class CNPG uses).
const LOCAL_PATH_CLAIMS: { name: string; size: string }[] = [
  { name: "drizzle-data", size: "1Gi" },
  { name: "maps", size: "2Gi" },
];

/**
 * @public - the GHCR imagePullSecret (ESO dockerconfigjson), the HA headless
 * Service, and every app Workload. Consumed by the cluster program (www-j934.6).
 */
export function deployServices(args: ServicesArgs): ServicesResources {
  const {
    provider,
    namespaces,
    mediaWorkerReplicas,
    cloudflaredReplicas,
    storybookReplicas,
    drizzleReplicas,
    nasNfsServer,
    imageDigests,
    vault,
  } = args;
  const opts = { provider };

  // GHCR pull secret: native dockerconfigjson Secret built from the PAT in vault.
  // The token is wrapped in pulumi.secret() so it's encrypted in Pulumi state.
  const pat = vault.GITHUB_PERSONAL_ACCESS_TOKEN__TOKEN;
  if (!pat) throw new Error("vault key GITHUB_PERSONAL_ACCESS_TOKEN__TOKEN not found");
  const authB64 = Buffer.from(`0x63616c:${pat}`).toString("base64");
  const dockerconfigjson = JSON.stringify({
    auths: { "ghcr.io": { username: "0x63616c", password: pat, auth: authB64 } },
  });
  const ghcrNamespaces = ["control-center", "captive-portal", "text-your-ex", "amp"] as const;
  const ghcrPullSecrets = ghcrNamespaces.map(
    (namespaceName) =>
      new k8s.core.v1.Secret(
        `${namespaceName}-ghcr-pull`,
        {
          metadata: { name: GHCR_PULL_SECRET, namespace: namespaces[namespaceName] },
          type: "kubernetes.io/dockerconfigjson",
          stringData: { ".dockerconfigjson": pulumi.secret(dockerconfigjson) },
        },
        opts,
      ),
  );

  // `ha` -> the host's tailnet FQDN (api/worker reach `http://ha:8123`, which
  // CNAMEs to the host socat via the locally-routed tailnet IP, www-j934.17).
  const haService = new ExternalService(
    {
      name: "ha",
      externalName: HA_TAILNET_FQDN,
      provider,
      namespace: namespaces["control-center"],
    },
    opts,
  );

  // local-path PVCs the workloads mount by claim name (web maps, drizzle data).
  const pvcs = LOCAL_PATH_CLAIMS.map(
    (c) =>
      new k8s.core.v1.PersistentVolumeClaim(
        c.name,
        {
          metadata: { name: c.name, namespace: namespaces["control-center"] },
          spec: {
            accessModes: ["ReadWriteOnce"],
            storageClassName: "local-path",
            resources: { requests: { storage: c.size } },
          },
        },
        opts,
      ),
  );

  const workloads = serviceSpecs({
    mediaWorkerReplicas,
    cloudflaredReplicas,
    storybookReplicas,
    drizzleReplicas,
    nasNfsServer,
    imageDigests,
  }).map(
    ({ namespaceName, ...spec }) =>
      new Workload({ ...spec, provider, namespace: namespaces[namespaceName] }, opts),
  );

  return { ghcrPullSecrets, haService, pvcs, workloads };
}
