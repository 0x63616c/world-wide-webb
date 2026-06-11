// The control-center app workloads on k3s (CC-j934.6): the Pulumi-era successor
// to deploy.config.ts's service() declarations. Each is a WorkloadSpec fed to
// the Workload component; secrets come from the ESO cc-secrets-<name> Secrets
// (CC-j934.4), images from GHCR via an imagePullSecret, caps are the CC-ke9a
// values verbatim. postgres is CNPG (CC-j934.5), not here.
//
// Boundary 6 (8GB, Swarm still runs prod until Phase-4 cutover): media-worker is
// declared replicas 1 so .6 can PROVE it Running + NFS-mounted (CC-6mz7 un-park),
// then it's scaled to 0 and parked until cutover. The other 8 stay up.

import * as k8s from "@pulumi/kubernetes";
import type * as pulumi from "@pulumi/pulumi";
import { ExternalService, Workload } from "./component.ts";
import type { WorkloadSpec } from "./spec.ts";

// GHCR image ref (mutable :main tag; CI digest-pins at deploy, deploy.config ghcr()).
const ghcr = (name: string) => `ghcr.io/0x63616c/control-center-${name}:main`;
// The imagePullSecret name (dockerconfigjson built by ESO from the GHCR token).
const GHCR_PULL_SECRET = "ghcr-pull";
// HA is reached via the host's TAILSCALE FQDN, NOT the LAN IP (CC-j934.17):
// OrbStack k8s pods can't route to 192.168.0.0/24 or raw host ports, but the
// Mac locally routes its OWN tailnet IP (utun) to its 0.0.0.0-bound socats, so
// homelab.tail8c014d.ts.net:8123 is delivered to the existing HA socat. The
// `ha` ExternalName Service CNAMEs to this; api/worker keep using http://ha:8123.
const HA_TAILNET_FQDN = "homelab.tail8c014d.ts.net";
const HA_PORT = 8123;

const TZ = "America/Los_Angeles";

// The CNPG read-write Service (CC-j934.5) the app connects to. env.ts builds
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
 * @public - all app WorkloadSpecs. mediaWorkerReplicas lets the program bring
 * media-worker up briefly (1) to prove it, then re-apply at 0 (Boundary 6).
 * nasNfsServer is the NFS server address for the media share: the NAS LAN IP by
 * default. The PV is mounted by kubelet in the node netns, which on homelab (the
 * prod target) reaches the home LAN directly (DESIGN 5b); the pod-egress no-route
 * limit (DESIGN 5c) does not apply to PV mounts. CC-j934.17.
 */
export function serviceSpecs(mediaWorkerReplicas: number, nasNfsServer: string): WorkloadSpec[] {
  return [
    {
      name: "api",
      image: ghcr("api"),
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
        "RESEND_API_KEY",
        "RESEND_FROM",
      ]),
      env: haEnv,
      ports: [{ containerPort: 4201, expose: "cluster" }],
      imagePullSecrets: [GHCR_PULL_SECRET],
    },
    {
      name: "worker",
      image: ghcr("worker"),
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
      name: "media-worker",
      image: ghcr("media-worker"),
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
      name: "web",
      image: ghcr("web"),
      replicas: 1,
      resources: { memory: "96M" },
      env: { TZ },
      ports: [{ containerPort: 80, expose: "cluster" }],
      // maps basemap served from a local-path PVC (provisioned by map-extract, .7).
      volumes: [{ mountPath: "/usr/share/nginx/html/maps", claim: "maps", readOnly: true }],
      imagePullSecrets: [GHCR_PULL_SECRET],
    },
    {
      name: "storybook",
      image: ghcr("storybook"),
      replicas: 1,
      resources: { memory: "96M" },
      env: { TZ },
      ports: [{ containerPort: 6006, expose: "cluster" }],
      imagePullSecrets: [GHCR_PULL_SECRET],
    },
    {
      name: "captive-portal",
      image: ghcr("captive-portal"),
      replicas: 1,
      resources: { memory: "64M" },
      env: { TZ },
      // LAN LoadBalancer on :443/:80 (republished on en1 by OrbStack expose_services).
      ports: [
        { containerPort: 443, expose: "lan" },
        { containerPort: 80, expose: "lan" },
      ],
      // Mount the cert-manager-issued TLS secret (CC-j934.5) for nginx.
      extraSecretMounts: [{ secretName: "captive-portal-tls", mountPath: "/certs" }],
      imagePullSecrets: [GHCR_PULL_SECRET],
    },
    {
      name: "drizzle",
      image: ghcr("drizzle"),
      replicas: 1,
      resources: { memory: "256M" },
      secrets: mount(["MASTERPASS", "POSTGRES_PASSWORD"]),
      env: { TZ, POSTGRES_HOST },
      ports: [{ containerPort: 4983, expose: "cluster" }],
      volumes: [{ mountPath: "/app", claim: "drizzle-data" }],
      imagePullSecrets: [GHCR_PULL_SECRET],
    },
    {
      name: "cloudflared",
      image: "cloudflare/cloudflared:2025.10.1",
      replicas: 2, // HA only, never an HPA.
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
  namespace: pulumi.Input<string>;
  // media-worker replicas: 1 to prove, 0 to park (Boundary 6).
  mediaWorkerReplicas: number;
  // NFS server for the media share: NAS LAN IP by default; kubelet mounts the PV
  // from the node netns, which reaches the LAN on homelab (DESIGN 5b/5c, CC-j934.17).
  nasNfsServer: string;
}

export interface ServicesResources {
  ghcrPullSecret: k8s.apiextensions.CustomResource;
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
 * Service, and every app Workload. Consumed by the cluster program (CC-j934.6).
 */
export function deployServices(args: ServicesArgs): ServicesResources {
  const { provider, namespace, mediaWorkerReplicas, nasNfsServer } = args;
  const opts = { provider };

  // GHCR pull secret: ESO templates a .dockerconfigjson from the GHCR token, so
  // no base64 is hand-assembled in Pulumi (the token value never touches state).
  const ghcrPullSecret = new k8s.apiextensions.CustomResource(
    "es-ghcr-pull",
    {
      apiVersion: "external-secrets.io/v1",
      kind: "ExternalSecret",
      metadata: { name: "es-ghcr-pull", namespace },
      spec: {
        refreshInterval: "1h",
        secretStoreRef: { kind: "ClusterSecretStore", name: "onepassword" },
        target: {
          name: GHCR_PULL_SECRET,
          template: {
            type: "kubernetes.io/dockerconfigjson",
            data: {
              ".dockerconfigjson":
                '{"auths":{"ghcr.io":{"username":"0x63616c","password":"{{ .token }}","auth":"{{ printf "0x63616c:%s" .token | b64enc }}"}}}',
            },
          },
        },
        data: [{ secretKey: "token", remoteRef: { key: "GitHub Personal Access Token/token" } }],
      },
    },
    opts,
  );

  // `ha` -> the host's tailnet FQDN (api/worker reach `http://ha:8123`, which
  // CNAMEs to the host socat via the locally-routed tailnet IP, CC-j934.17).
  const haService = new ExternalService(
    { name: "ha", externalName: HA_TAILNET_FQDN, provider, namespace },
    opts,
  );

  // local-path PVCs the workloads mount by claim name (web maps, drizzle data).
  const pvcs = LOCAL_PATH_CLAIMS.map(
    (c) =>
      new k8s.core.v1.PersistentVolumeClaim(
        c.name,
        {
          metadata: { name: c.name, namespace },
          spec: {
            accessModes: ["ReadWriteOnce"],
            storageClassName: "local-path",
            resources: { requests: { storage: c.size } },
          },
        },
        opts,
      ),
  );

  const workloads = serviceSpecs(mediaWorkerReplicas, nasNfsServer).map(
    (spec) => new Workload({ spec, provider, namespace }, opts),
  );

  return { ghcrPullSecret, haService, pvcs, workloads };
}
