// The control-center app workloads on k3s (www-j934.6): the Pulumi-era successor
// to deploy.config.ts's service() declarations. Each is a WorkloadSpec fed to
// the Workload component; secrets come from product-derived service Secrets
// (www-j934.4), images from GHCR via an imagePullSecret, caps are the www-ke9a
// values verbatim. postgres is CNPG (www-j934.5), not here.
//
// Boundary 6 (8GB, Swarm still runs prod until Phase-4 cutover): media-worker is
// declared replicas 1 so .6 can PROVE it Running + NFS-mounted (www-6mz7 un-park),
// then it's scaled to 0 and parked until cutover. The other 8 stay up.

import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import {
  captivePortalProductManifest,
  controlCenterProductManifest,
  defineProduct,
} from "@www/platform";
import type { InfraNamespaceName } from "./cluster.ts";
import type { WorkloadSpec } from "./component.ts";
import { ExternalService, Workload } from "./component.ts";
import { GHCR_PULL_SECRET_NAME, GHCR_PULL_SECRET_NAMESPACES } from "./ghcr-pull-secrets.ts";
import { SERVICE_SECRET_TARGETS } from "./secrets-map.ts";

// Per-service GHCR image digest map, name -> "sha256:…", set by the CI deploy job
// (`pulumi config set --path imageDigests.<svc>`). A pinned digest renders the
// image as @sha256:… so only the workloads whose digest changed roll on a
// `pulumi up` (the www-czg digest-pin property, now driven by Pulumi config).
// Empty only in non-prod local/dev applies, where :main is fine.
export type ImageDigests = Record<string, string>;
export type OwnedWorkloadSpec = WorkloadSpec & { namespaceName: InfraNamespaceName };

const controlCenterProduct = defineProduct("control-center");
const captivePortalProduct = defineProduct("captive-portal");

const IMAGE_REPOSITORIES = {
  api: {
    digestKey: controlCenterProduct.imageDigestKey("api"),
    repository: controlCenterProduct.imageRepository("api"),
  },
  worker: {
    digestKey: controlCenterProduct.imageDigestKey("worker"),
    repository: controlCenterProduct.imageRepository("worker"),
  },
  "media-worker": {
    digestKey: controlCenterProduct.imageDigestKey("media-worker"),
    repository: controlCenterProduct.imageRepository("media-worker"),
  },
  web: {
    digestKey: controlCenterProduct.imageDigestKey("web"),
    repository: controlCenterProduct.imageRepository("web"),
  },
  storybook: {
    digestKey: controlCenterProduct.imageDigestKey("storybook"),
    repository: controlCenterProduct.imageRepository("storybook"),
  },
  drizzle: {
    digestKey: controlCenterProduct.imageDigestKey("drizzle"),
    repository: controlCenterProduct.imageRepository("drizzle"),
  },
  "map-provision": {
    digestKey: controlCenterProduct.imageDigestKey("map-provision"),
    repository: controlCenterProduct.imageRepository("map-provision"),
  },
  "captive-portal": {
    digestKey: captivePortalProduct.imageDigestKey("portal"),
    repository: captivePortalProduct.imageRepository("portal"),
  },
  "captive-portal-api": {
    digestKey: captivePortalProduct.imageDigestKey("api"),
    repository: captivePortalProduct.imageRepository("api"),
  },
} as const satisfies Record<string, { digestKey: string; repository: string }>;

const IMAGE_DIGEST_KEYS = new Set(
  Object.values(IMAGE_REPOSITORIES).map((image) => image.digestKey),
);
const REQUIRED_IMAGE_DIGEST_KEYS = Object.values(IMAGE_REPOSITORIES).map(
  (image) => image.digestKey,
);

function validateImageDigests(digests: ImageDigests): void {
  for (const key of Object.keys(digests)) {
    if (!IMAGE_DIGEST_KEYS.has(key)) {
      throw new Error(`imageDigests.${key} is not a known product-component image key`);
    }
  }
}

function validateRequiredImageDigests(digests: ImageDigests): void {
  const missing = REQUIRED_IMAGE_DIGEST_KEYS.filter((key) => !digests[key]);
  if (missing.length > 0) {
    throw new Error(
      `prod stack requires wwwinfra:imageDigests pins for app images; missing: ${missing.join(
        ", ",
      )}`,
    );
  }
}

export function shouldRequireImageDigestPins(stackName: string): boolean {
  return stackName === "prod";
}

// GHCR image ref. Digest-pinned (@sha256:…) when CI supplied a digest for this
// service, else the mutable :main tag (local applies, first deploy before any
// digest is set). The digest is validated shape-wise so a malformed config value
// can't silently produce an unpullable ref.
const ghcr = (name: string, digests: ImageDigests = {}): string => {
  const image = IMAGE_REPOSITORIES[name as keyof typeof IMAGE_REPOSITORIES];
  if (!image) throw new Error(`no image repository configured for ${name}`);
  const digest = digests[image.digestKey];
  if (digest) {
    if (!/^sha256:[0-9a-f]{64}$/.test(digest)) {
      throw new Error(`imageDigests.${image.digestKey} is not a sha256:<64-hex> digest: ${digest}`);
    }
    return `${image.repository}@${digest}`;
  }
  return `${image.repository}:main`;
};
// The imagePullSecret name (dockerconfigjson built by ESO from the GHCR token).
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
const controlCenterDatabase = controlCenterProductManifest().database;
const captivePortalManifest = captivePortalProductManifest();
const captivePortalDatabase = captivePortalManifest.database;

// go2rtc: the in-cluster RTSP->MJPEG restreamer for the bedroom camera. It runs
// in the control-center namespace as a ClusterIP Service on :1984, and the api
// proxies its MJPEG endpoint at /media/camera-stream. This deliberately does NOT
// go through Home Assistant: the camera is reachable directly over RTSP, so the
// tile stays up when HA is down. Only the RTSP credentials are secret (they ride
// in the composed go2rtc.yaml Secret below); these three are plain env.
const GO2RTC_SERVICE_NAME = "go2rtc";
const GO2RTC_PORT = 1984;
const GO2RTC_CONFIG_SECRET_NAME = "control-center-go2rtc-config";
const GO2RTC_CONFIG_MOUNT_PATH = "/config";
// Pinned tag, never :latest — a mutable upstream tag would silently roll the
// restreamer on every node restart. Not a GHCR image, so no digest pin (an
// unknown key in wwwinfra:imageDigests hard-fails validateImageDigests).
const GO2RTC_IMAGE = "alexxit/go2rtc:1.9.9";
const CAMERA_STREAM_NAME = "bedroom_mjpeg";
const CAMERA_LABEL = "Living Room Cam";

// Shared non-secret env for api + worker (HA reached via the in-cluster `ha`
// Service name now, not host.docker.internal; DB via the CNPG Service).
const haEnv = {
  NODE_ENV: "production",
  APP_ENV: "production",
  TZ,
  HA_URL: `http://ha:${HA_PORT}`,
  UNIFI_CONTROLLER_URL: "https://192.168.0.1",
  POSTGRES_HOST: controlCenterDatabase.rwServiceName,
  GO2RTC_URL: `http://${GO2RTC_SERVICE_NAME}:${GO2RTC_PORT}`,
  CAMERA_STREAM_NAME,
  CAMERA_LABEL,
};

// secretsFor: a marker list so the Workload mounts its configured service Secret; the actual
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
 * - imageDigests: CI-supplied digest pin map (name -> sha256:…); absent only in
 *   non-prod local applies, where every image falls back to the :main tag. www-j934.14.
 * - requireImageDigestPins: prod safety guard. Refuse to render app Deployments
 *   with mutable/private :main images when wwwinfra:imageDigests is incomplete.
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
  requireImageDigestPins?: boolean;
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
    requireImageDigestPins = false,
  } = opts;
  validateImageDigests(digests);
  if (requireImageDigestPins) validateRequiredImageDigests(digests);
  return [
    {
      logicalName: "control-center-api",
      legacyLogicalName: "api",
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
        "ASC_KEY_ID",
        "ASC_ISSUER_ID",
        "ASC_KEY_CONTENT",
      ]),
      secretName: SERVICE_SECRET_TARGETS.api.secretName,
      // Wake photos persist on the NAS media share (same NFS export + subPath
      // as media-worker); without this mount the api's MEDIA_STORAGE_DIR
      // writes land in the container overlay fs and vanish on every roll.
      env: { ...haEnv, MEDIA_STORAGE_DIR: "/app/media" },
      volumes: [
        {
          mountPath: "/app/media",
          nfs: { server: nasNfsServer, path: "/volume1/Homelab" },
          subPath: "media",
        },
      ],
      ports: [{ containerPort: 4201, expose: "cluster" }],
      imagePullSecrets: [GHCR_PULL_SECRET_NAME],
    },
    {
      logicalName: "control-center-worker",
      legacyLogicalName: "worker",
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
        "ASC_KEY_ID",
        "ASC_ISSUER_ID",
        "ASC_KEY_CONTENT",
      ]),
      secretName: SERVICE_SECRET_TARGETS.worker.secretName,
      env: haEnv,
      imagePullSecrets: [GHCR_PULL_SECRET_NAME],
    },
    {
      logicalName: "control-center-media-worker",
      legacyLogicalName: "media-worker",
      name: "media-worker",
      namespaceName: "control-center",
      image: ghcr("media-worker", digests),
      replicas: mediaWorkerReplicas,
      resources: { memory: "1G" },
      secrets: mount(["POSTGRES_PASSWORD", "OPENROUTER_API_KEY"]),
      secretName: SERVICE_SECRET_TARGETS["media-worker"].secretName,
      env: {
        NODE_ENV: "production",
        APP_ENV: "production",
        TZ,
        POSTGRES_HOST: controlCenterDatabase.rwServiceName,
        // Point at the NFS mount below , the env default (/mnt/media) is the
        // container overlay fs, not the NAS share.
        MEDIA_STORAGE_DIR: "/app/media",
      },
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
      imagePullSecrets: [GHCR_PULL_SECRET_NAME],
    },
    {
      logicalName: "control-center-web",
      legacyLogicalName: "web",
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
      imagePullSecrets: [GHCR_PULL_SECRET_NAME],
    },
    {
      logicalName: "control-center-storybook",
      legacyLogicalName: "storybook",
      name: "storybook",
      namespaceName: "control-center",
      image: ghcr("storybook", digests),
      replicas: storybookReplicas,
      resources: { memory: "96M" },
      env: { TZ },
      ports: [{ containerPort: 6006, expose: "cluster" }],
      imagePullSecrets: [GHCR_PULL_SECRET_NAME],
    },
    {
      logicalName: "captive-portal-portal",
      legacyLogicalName: "captive-portal",
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
      imagePullSecrets: [GHCR_PULL_SECRET_NAME],
    },
    {
      logicalName: "captive-portal-api",
      name: "api",
      namespaceName: "captive-portal",
      image: ghcr("captive-portal-api", digests),
      replicas: 1,
      resources: { memory: "256M" },
      secrets: mount(["POSTGRES_PASSWORD", "UNIFI_API_KEY", "WIFI_PASSWORD", "WIFI_SSID"]),
      secretName: captivePortalManifest.secretUsages.api.targetSecretName,
      env: {
        TZ,
        APP_ENV: "production",
        NODE_ENV: "production",
        PORT: "4211",
        POSTGRES_HOST: captivePortalDatabase.rwServiceName,
        POSTGRES_DB: captivePortalDatabase.databaseName,
        POSTGRES_USER: captivePortalDatabase.owner,
      },
      ports: [{ containerPort: 4211, expose: "cluster" }],
      imagePullSecrets: [GHCR_PULL_SECRET_NAME],
    },
    {
      logicalName: "control-center-drizzle",
      legacyLogicalName: "drizzle",
      name: "drizzle",
      namespaceName: "control-center",
      image: ghcr("drizzle", digests),
      replicas: drizzleReplicas,
      resources: { memory: "256M" },
      secrets: mount(["MASTERPASS", "POSTGRES_PASSWORD"]),
      secretName: SERVICE_SECRET_TARGETS.drizzle.secretName,
      env: { TZ, POSTGRES_HOST: controlCenterDatabase.rwServiceName },
      ports: [{ containerPort: 4983, expose: "cluster" }],
      volumes: [{ mountPath: "/app", claim: "drizzle-data" }],
      imagePullSecrets: [GHCR_PULL_SECRET_NAME],
    },
    {
      // Plex Media Server (third-party). Serves the Synology media share to the
      // Apple TV. Not a control-center product component, but co-located in the
      // control-center namespace to reuse the media NFS share + a local-path PVC.
      logicalName: "control-center-plex",
      name: "plex",
      namespaceName: "control-center",
      // Version-pinned public image (multi-arch; arm64 manifest for the OrbStack
      // node). Third-party like cloudflared: no GHCR pull secret, no digest pin.
      image: "plexinc/pms-docker:1.43.2.10687-563d026ea",
      replicas: 1,
      resources: { memory: "1G", reserveCpus: "0.5" },
      env: {
        TZ,
        HOSTNAME: "Plex",
        // No PLEX_CLAIM: plex.tv/claim tokens expire in ~4 min so none can be
        // pre-stored. The server boots UNCLAIMED; claim it once via the web UI
        // (docs/plex.md). ADVERTISE_IP publishes the Mac-host LAN address so
        // clients get a directly-reachable URL, not the OrbStack-internal pod IP:
        // the LoadBalancer port below is republished by OrbStack on the Mac host
        // at 192.168.0.147:32400 (en0 LAN). Update if the Mac's LAN IP changes.
        ADVERTISE_IP: "http://192.168.0.147:32400",
      },
      // Plex config/metadata (SQLite) MUST live on fast local disk, never NFS
      // (SQLite over NFS corrupts). local-path PVC on the OrbStack SSD.
      // The media share is the same NFS export + subPath as media-worker, mounted
      // read-only; point a Plex library at /data (docs/plex.md).
      volumes: [
        { mountPath: "/config", claim: "plex-config" },
        {
          mountPath: "/data",
          nfs: { server: nasNfsServer, path: "/volume1/Homelab" },
          subPath: "media",
          readOnly: true,
        },
      ],
      // LAN LoadBalancer on :32400 (republished on the Mac host by OrbStack
      // expose_services, same mechanism as the captive-portal LB), so the Apple
      // TV on 192.168.0.0/24 reaches Plex directly.
      ports: [{ containerPort: 32400, expose: "lan" }],
    },
    {
      // go2rtc restreams the bedroom camera's RTSP feed as MJPEG for the web
      // tile (the browser can't play RTSP). Public Docker Hub image on a pinned
      // tag, so no GHCR pull secret and no digest pin. Its whole config is the
      // composed `control-center-go2rtc-config` Secret (deployServices below),
      // mounted read-only at go2rtc's default config dir /config — the image's
      // own entrypoint then reads /config/go2rtc.yaml, so no `command` override
      // (a k8s `command` REPLACES the entrypoint outright).
      logicalName: "control-center-go2rtc",
      name: GO2RTC_SERVICE_NAME,
      namespaceName: "control-center",
      image: GO2RTC_IMAGE,
      replicas: 1,
      resources: { memory: "256M" },
      env: { TZ },
      ports: [{ containerPort: GO2RTC_PORT, expose: "cluster" }],
      extraSecretMounts: [
        { secretName: GO2RTC_CONFIG_SECRET_NAME, mountPath: GO2RTC_CONFIG_MOUNT_PATH },
      ],
      // Public upstream image; no GHCR pull secret.
    },
    {
      logicalName: "platform-cloudflared",
      legacyLogicalName: "cloudflared",
      name: "cloudflared",
      namespaceName: "platform",
      image: "cloudflare/cloudflared:2025.10.1",
      replicas: cloudflaredReplicas, // HA (2) at cutover; 0 pre-cutover so it
      // does not hold the live tunnel token alongside Swarm (www-j934.9 / §7).
      resources: { memory: "128M", reserveCpus: "0.25" },
      secrets: mount(["TUNNEL_TOKEN"]),
      secretName: SERVICE_SECRET_TARGETS.cloudflared.secretName,
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
  // Prod stack guard against rendering app Deployments with mutable :main images.
  requireImageDigestPins?: boolean;
  // Decrypted vault from vault.ts (CC-k8t7).
  vault: Record<string, string>;
}

export interface ServicesResources {
  ghcrPullSecrets: k8s.core.v1.Secret[];
  go2rtcConfigSecret: k8s.core.v1.Secret;
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
  // Plex config/metadata/thumbnails on the OrbStack SSD (SQLite must not be on
  // NFS). Mounted at /config by the plex workload above.
  { name: "plex-config", size: "10Gi" },
];

// The go2rtc config, composed from the vault (the RTSP creds are NOT ESO
// /run/secrets files: go2rtc only reads a config file, so the credentials are
// interpolated into the rtsp:// URL here and the whole file ships as one k8s
// Secret). Username/password are URL-encoded so a `@`, `:` or `/` in the
// password can't break the URL's authority section.
// `bedroom` is the raw RTSP pull; `bedroom_mjpeg` is the ffmpeg transcode the
// browser tile consumes, downscaled to 960px wide (full 1080p MJPEG is ~7 Mbps,
// wasteful for a small tile).
function composeGo2rtcConfig(vault: Record<string, string>): string {
  const required = [
    "EUFY_BEDROOM_CAM__HOST",
    "EUFY_BEDROOM_CAM__RTSP_USERNAME",
    "EUFY_BEDROOM_CAM__RTSP_PASSWORD",
    "EUFY_BEDROOM_CAM__RTSP_PATH",
  ] as const;
  for (const key of required) {
    if (!vault[key]) throw new Error(`vault key ${key} not found`);
  }
  const host = vault.EUFY_BEDROOM_CAM__HOST as string;
  const username = encodeURIComponent(vault.EUFY_BEDROOM_CAM__RTSP_USERNAME as string);
  const password = encodeURIComponent(vault.EUFY_BEDROOM_CAM__RTSP_PASSWORD as string);
  const path = (vault.EUFY_BEDROOM_CAM__RTSP_PATH as string).replace(/^\/+/, "");
  const rtspUrl = `rtsp://${username}:${password}@${host}:554/${path}`;
  return [
    "api:",
    `  listen: ":${GO2RTC_PORT}"`,
    "streams:",
    "  bedroom:",
    `    - ${rtspUrl}`,
    `  ${CAMERA_STREAM_NAME}:`,
    "    - ffmpeg:bedroom#video=mjpeg#width=960",
    "log:",
    "  level: info",
    "",
  ].join("\n");
}

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
    requireImageDigestPins,
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
  const ghcrPullSecrets = GHCR_PULL_SECRET_NAMESPACES.map(
    (namespaceName) =>
      new k8s.core.v1.Secret(
        `${namespaceName}-ghcr-pull`,
        {
          metadata: { name: GHCR_PULL_SECRET_NAME, namespace: namespaces[namespaceName] },
          type: "kubernetes.io/dockerconfigjson",
          stringData: { ".dockerconfigjson": pulumi.secret(dockerconfigjson) },
        },
        opts,
      ),
  );

  // go2rtc's whole config (including the camera's RTSP credentials), composed
  // from the vault and shipped as one Secret mounted read-only at /config.
  // pulumi.secret() keeps the RTSP password encrypted in Pulumi state.
  const go2rtcConfigSecret = new k8s.core.v1.Secret(
    GO2RTC_CONFIG_SECRET_NAME,
    {
      metadata: {
        name: GO2RTC_CONFIG_SECRET_NAME,
        namespace: namespaces["control-center"],
      },
      stringData: { "go2rtc.yaml": pulumi.secret(composeGo2rtcConfig(vault)) },
    },
    opts,
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
    requireImageDigestPins,
  }).map(
    ({ namespaceName, ...spec }) =>
      new Workload(
        { ...spec, provider, namespace: namespaces[namespaceName] },
        // go2rtc can't start until its config Secret exists (the pod would sit in
        // ContainerCreating on the missing volume), so order it after the Secret.
        spec.name === GO2RTC_SERVICE_NAME ? { ...opts, dependsOn: [go2rtcConfigSecret] } : opts,
      ),
  );

  return { ghcrPullSecrets, go2rtcConfigSecret, haService, pvcs, workloads };
}
