// The control-center app workloads (www-j934.6): the Pulumi-era successor
// to deploy.config.ts's service() declarations. Each is a WorkloadSpec fed to
// the Workload component; secrets come from product-derived service Secrets
// (www-j934.4), images from GHCR via an imagePullSecret, caps are the www-ke9a
// values verbatim. postgres is CNPG (www-j934.5), not here.
//
// The media pipeline (playlist poller, ingest queue, NAS media mount) lives in
// the worker workload: media-worker was merged into it, so there is one worker
// deployable rather than a second, permanently-parked one.

import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { controlCenterProductManifest, defineProduct, type ProductSlug } from "@www/platform";
import { DEFAULT_METRICS_PORT } from "@www/platform/metrics/port";
import type { InfraNamespaceName } from "./cluster.ts";
import type { WorkloadSpec } from "./component.ts";
import { ExternalService, HostBackedService, Workload } from "./component.ts";
import { GHCR_PULL_SECRET_NAME, GHCR_PULL_SECRET_NAMESPACES } from "./ghcr-pull-secrets.ts";
import { SERVICE_SECRET_TARGETS, SERVICE_SECRETS, type ServiceSecretName } from "./secrets-map.ts";

// Per-service GHCR image digest map, name -> "sha256:…", set by the CI deploy job
// (`pulumi config set --path imageDigests.<svc>`). A pinned digest renders the
// image as @sha256:… so only the workloads whose digest changed roll on a
// `pulumi up` (the www-czg digest-pin property, now driven by Pulumi config).
// Empty only in non-prod local/dev applies, where :main is fine.
export type ImageDigests = Record<string, string>;
export type OwnedWorkloadSpec = WorkloadSpec & { namespaceName: InfraNamespaceName };

const controlCenterProduct = defineProduct("control-center");
const IMAGE_REPOSITORIES = {
  api: {
    product: "control-center",
    digestKey: controlCenterProduct.imageDigestKey("api"),
    repository: controlCenterProduct.imageRepository("api"),
  },
  worker: {
    product: "control-center",
    digestKey: controlCenterProduct.imageDigestKey("worker"),
    repository: controlCenterProduct.imageRepository("worker"),
  },
  web: {
    product: "control-center",
    digestKey: controlCenterProduct.imageDigestKey("web"),
    repository: controlCenterProduct.imageRepository("web"),
  },
  // manage (apps/manage, ADR-0010): a static nginx bundle, same shape as web.
  manage: {
    product: "control-center",
    digestKey: controlCenterProduct.imageDigestKey("manage"),
    repository: controlCenterProduct.imageRepository("manage"),
  },
} as const satisfies Record<
  string,
  { product: ProductSlug; digestKey: string; repository: string }
>;

const IMAGE_DIGEST_KEYS = new Set(
  Object.values(IMAGE_REPOSITORIES).map((image) => image.digestKey),
);
/**
 * The digest keys belonging to one product.
 *
 * Required pins are asked for PER PRODUCT, not across the whole map. Each
 * renderer asserts the pins it actually needs.
 *
 * `imageDigestKey` is `${slug}-${component}`, so the prefix is the product.
 */
/**
 * @public - the digest keys one product owns, from a table of images.
 *
 * Ownership is DECLARED on each entry, never inferred from a key's spelling. A
 * `startsWith(`${slug}-`)` test reads as exact and silently over-matches the
 * day one slug prefixes another — "control-center" would swallow a future
 * "control-center-edge" and quietly widen what a prod deploy demands. Putting
 * the prefix on the repository name instead has the identical bug.
 *
 * It takes the table as an argument rather than closing over IMAGE_REPOSITORIES
 * so the difference is TESTABLE: with only today's mutually non-prefixing
 * slugs, an equality filter and a prefix filter behave identically, and the
 * improvement would be unfalsifiable closed over the live table.
 */
export function keysOwnedBy<T extends { product: string; digestKey: string }>(
  images: readonly T[],
  slug: string,
): string[] {
  return images.filter((image) => image.product === slug).map((image) => image.digestKey);
}

function digestKeysFor(slug: ProductSlug): string[] {
  return keysOwnedBy(Object.values(IMAGE_REPOSITORIES), slug);
}

const REQUIRED_IMAGE_DIGEST_KEYS = digestKeysFor("control-center");

/**
 * @public - asserts that every image this product ships is digest-pinned.
 *
 * For renderers outside serviceSpecs that must not render a mutable `:main`
 * ref on a production cluster either.
 */
export function assertImageDigestPins(slug: ProductSlug, digests: ImageDigests): void {
  const missing = digestKeysFor(slug).filter((key) => !digests[key]);
  if (missing.length > 0) {
    throw new Error(
      `prod stack requires wwwinfra:imageDigests pins for ${slug} images; missing: ${missing.join(", ")}`,
    );
  }
}

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

// Stacks that manage a real production cluster: app Deployments must NOT render
// mutable :main images there (an incomplete CI digest map is a hard error, not a
// silent :main fallback). "prod" is the retired mini; "home-server" is the live
// Talos cluster CI now deploys to.
const PROD_LIKE_STACKS = new Set(["prod", "home-server"]);

export function shouldRequireImageDigestPins(stackName: string): boolean {
  return PROD_LIKE_STACKS.has(stackName);
}

// GHCR image ref. Digest-pinned (@sha256:…) when CI supplied a digest for this
// service, else the mutable :main tag (local applies, first deploy before any
// digest is set). The digest is validated shape-wise so a malformed config value
// can't silently produce an unpullable ref.
const ghcrImage = (name: string, digests: ImageDigests = {}): string => {
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

// The two substrates this program can target: "talos" is the live `home-server`
// cluster (amd64, `infra/Pulumi.home-server.yaml` pins `wwwinfra:substrate:
// talos` explicitly) and is the ONLY deployed stack; "orbstack" is a
// zero-config local-preview fallback for a developer's own OrbStack
// Kubernetes on their Mac, used when `wwwinfra:substrate` is unset (e.g. an
// unconfigured `pulumi preview`). It is not tied to any specific machine and
// is never the target of a real `pulumi up` today — the one machine it used
// to mean, the Mac mini, was retired 2026-07-25 and its stack config
// (`Pulumi.prod.yaml`) deleted. Never add a third value without re-auditing
// every haTarget call site.
export type Substrate = "orbstack" | "talos";

/**
 * Boundary-validates the raw `wwwinfra:substrate` Pulumi config string (or
 * undefined) into a {@link Substrate}. Missing config = "orbstack", the
 * local-preview default (see the Substrate doc above) — NOT what the deployed
 * `home-server` stack uses, which always sets `wwwinfra:substrate: talos`
 * explicitly. Any value other than the two known substrates is a hard config
 * error, not a silent fallback.
 *
 * @public - unit-tested in infra/test/services.test.ts.
 */
export function parseSubstrate(value: string | undefined): Substrate {
  if (value === undefined || value === "orbstack") return "orbstack";
  if (value === "talos") return "talos";
  throw new Error(`wwwinfra:substrate must be "orbstack" or "talos", got "${value}"`);
}

// Task 3 shipped haTarget as `(substrate: Substrate, nodeIp:
// string)`, with nodeIp defaulting to "" on orbstack — a representable-but-
// meaningless state (an empty nodeIp could in principle reach the "talos"
// branch of a future call site and silently render `http://:32400`). Task 4's
// deferred cleanup: nodeIp only EXISTS on the "talos" variant, so a talos code
// path with no nodeIp is a compile error, not a runtime footgun.
export type SubstrateTarget =
  | { readonly substrate: "talos"; readonly nodeIp: string }
  | { readonly substrate: "orbstack" };

// The Talos node's static LAN IP (locked decision), used when talos is
// selected but no explicit `wwwinfra:nodeIp` override is configured.
const DEFAULT_TALOS_NODE_IP = "192.168.0.5";

/**
 * Boundary-validates the raw `wwwinfra:substrate` + `wwwinfra:nodeIp` Pulumi
 * config strings into a {@link SubstrateTarget}. This is the ONLY place a
 * nodeIp is attached to a substrate; every other function in this module
 * takes the already-validated union, so "talos with no nodeIp" cannot occur
 * downstream.
 *
 * @public - unit-tested in infra/test/services.test.ts; consumed by program.ts.
 */
export function parseSubstrateTarget(
  substrateValue: string | undefined,
  nodeIpValue: string | undefined,
): SubstrateTarget {
  const substrate = parseSubstrate(substrateValue);
  if (substrate === "orbstack") return { substrate: "orbstack" };
  return {
    substrate: "talos",
    nodeIp: nodeIpValue && nodeIpValue.length > 0 ? nodeIpValue : DEFAULT_TALOS_NODE_IP,
  };
}

// Orbstack (local-preview) values are frozen: they must never change as a
// side effect of this file. The talos counterparts route through the node's
// LAN IP instead (see haTarget).

/**
 * The `ha` ExternalName Service target (www-j934.17). On "orbstack"
 * (local-preview default) this is unconditionally the host's tailnet FQDN:
 * OrbStack pods can't route to the LAN, but the Mac locally routes its own
 * tailnet IP to the host HA socat (see the HA_TAILNET_FQDN comment above). On
 * "talos" — the deployed `home-server` stack — api/
 * worker are ordinary (non-hostNetwork) pods, so they can't reach a
 * hostNetwork HA via loopback — HA binds :8123 in the *node's* netns, which is
 * reachable from any pod at the node's LAN IP.
 *
 * @public - unit-tested in infra/test/services.test.ts; consumed by
 * deployServices below and by Task 4.
 */
export function haTarget(target: SubstrateTarget): string {
  return target.substrate === "talos" ? target.nodeIp : HA_TAILNET_FQDN;
}

const TZ = "America/Los_Angeles";

// The CNPG read-write Service (www-j934.5) the app connects to. env.ts builds
// DATABASE_URL as postgres://postgres:<pw>@$POSTGRES_HOST:5432/control_center;
// the default host "postgres" was the Swarm service name and does NOT resolve in
// the cluster, so set it to the CNPG Service explicitly (a live-deploy finding).
const controlCenterDatabase = controlCenterProductManifest().database;

// Shared non-secret env for api + worker (HA reached via the in-cluster `ha`
// Service name now, not host.docker.internal; DB via the CNPG Service).
const haEnv = {
  NODE_ENV: "production",
  APP_ENV: "production",
  TZ,
  HA_URL: `http://ha:${HA_PORT}`,
  POSTGRES_HOST: controlCenterDatabase.rwServiceName,
};

// A marker list so the Workload mounts its configured service Secret; the actual
// key -> vault-key mapping lives in SERVICE_SECRETS (derived from the platform
// manifest). The render layer only reads .length to decide whether to attach the
// /run/secrets volume, so we derive the names straight from SERVICE_SECRETS and
// this list can never drift from what eso.ts actually syncs.
const mountSecrets = (service: ServiceSecretName) =>
  Object.keys(SERVICE_SECRETS[service]).map((name) => ({ name, ref: "eso" }));

/**
 * Replica/topology knobs the program threads in at apply time.
 * - cloudflaredReplicas: 0 for a pre-cutover bring-up (so the new cloudflared does
 *   NOT grab the live tunnel token and split-brain prod with Swarm), flipped to 2
 *   (HA) at the cutover (www-j934.9 / DESIGN §7 step 3).
 * - nasNfsServer: the NFS server address for the media share, the NAS LAN IP by
 *   default. The PV is mounted by kubelet in the node netns, which on home-server (the
 *   prod target) reaches the home LAN directly (DESIGN 5b); the pod-egress no-route
 *   limit (DESIGN 5c) does not apply to PV mounts. www-j934.17.
 * - imageDigests: CI-supplied digest pin map (name -> sha256:…); absent only in
 *   non-prod local applies, where every image falls back to the :main tag. www-j934.14.
 * - requireImageDigestPins: prod safety guard. Refuse to render app Deployments
 *   with mutable/private :main images when wwwinfra:imageDigests is incomplete.
 */
export interface ServiceSpecOptions {
  cloudflaredReplicas: number;
  nasNfsServer: string;
  imageDigests?: ImageDigests;
  requireImageDigestPins?: boolean;
}

/** @public - all app WorkloadSpecs, parameterised by {@link ServiceSpecOptions}. */
export function serviceSpecs(opts: ServiceSpecOptions): OwnedWorkloadSpec[] {
  const {
    cloudflaredReplicas,
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
      image: ghcrImage("api", digests),
      replicas: 1,
      // 1G, not 512M: the api sits at ~70 MiB steady state but bursts to ~405 MiB
      // for 3-16 minutes at a time (~83% of a 512M limit), so a slightly larger
      // burst would OOM-kill it and take the panel down. Interim headroom while
      // #306 chases the retention that drives the burst , not a fix.
      resources: { memory: "1G", reserveCpus: "0.5" },
      secrets: mountSecrets("api"),
      secretName: SERVICE_SECRET_TARGETS.api.secretName,
      // Wake photos persist on the NAS media share (same NFS export + subPath
      // as the worker); without this mount the api's MEDIA_STORAGE_DIR
      // writes land in the container overlay fs and vanish on every roll.
      env: {
        ...haEnv,
        MEDIA_STORAGE_DIR: "/app/media",
      },
      volumes: [
        {
          mountPath: "/app/media",
          nfs: { server: nasNfsServer, path: "/volume1/Homelab" },
          subPath: "media",
        },
      ],
      ports: [{ containerPort: 4201, expose: "cluster" }],
      imagePullSecrets: [GHCR_PULL_SECRET_NAME],
      // #214. The metrics listener is a SEPARATE port from the 4201 above and
      // is deliberately absent from `ports`: anything listed in `ports` gets a
      // Service. Prometheus scrapes the pod IP directly off these annotations.
      scrape: { port: DEFAULT_METRICS_PORT },
    },
    {
      logicalName: "control-center-worker",
      legacyLogicalName: "worker",
      name: "worker",
      namespaceName: "control-center",
      image: ghcrImage("worker", digests),
      replicas: 1,
      resources: { memory: "512M" },
      secrets: mountSecrets("worker"),
      secretName: SERVICE_SECRET_TARGETS.worker.secretName,
      env: {
        ...haEnv,
        // Point at the NFS mount below -- the env default (/mnt/media) is the
        // container overlay fs, not the NAS share.
        MEDIA_STORAGE_DIR: "/app/media",
      },
      // NFS PV for the Synology media share. The DS420+ exports ONLY
      // /volume1/Homelab (not its subdirs), so mount that export and subPath
      // into media/. nfsvers=4.0 is enforced by the render layer (the Talos node
      // does in-kernel NFSv4 mounts only; NFSv4 is enabled on the DS420+).
      volumes: [
        {
          mountPath: "/app/media",
          nfs: { server: nasNfsServer, path: "/volume1/Homelab" },
          subPath: "media",
        },
      ],
      imagePullSecrets: [GHCR_PULL_SECRET_NAME],
      // #214: the worker serves no other HTTP, so this is its only listener.
      scrape: { port: DEFAULT_METRICS_PORT },
    },
    {
      logicalName: "control-center-web",
      legacyLogicalName: "web",
      name: "web",
      namespaceName: "control-center",
      image: ghcrImage("web", digests),
      replicas: 1,
      resources: { memory: "96M" },
      env: { TZ },
      ports: [{ containerPort: 80, expose: "cluster" }],
      imagePullSecrets: [GHCR_PULL_SECRET_NAME],
    },
    {
      // manage (ADR-0010): the management plane at manage.worldwidewebb.co.
      // Static bundle behind nginx, no api and no database — it holds no
      // credentials of its own, and Cloudflare Access is the only gate.
      logicalName: "control-center-manage",
      name: "manage",
      namespaceName: "control-center",
      image: ghcrImage("manage", digests),
      replicas: 1,
      resources: { memory: "64M" },
      env: { TZ },
      ports: [{ containerPort: 80, expose: "cluster" }],
      imagePullSecrets: [GHCR_PULL_SECRET_NAME],
    },
    {
      logicalName: "cloudflare-cloudflared",
      legacyLogicalName: "platform-cloudflared",
      name: "cloudflared",
      namespaceName: "cloudflare",
      image: "cloudflare/cloudflared:2025.10.1",
      replicas: cloudflaredReplicas, // HA (2) at cutover; 0 pre-cutover so it
      // does not hold the live tunnel token alongside Swarm (www-j934.9 / §7).
      resources: { memory: "128M", reserveCpus: "0.25" },
      secrets: mountSecrets("cloudflared"),
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
  // cloudflared replicas: 0 for a pre-cutover bring-up (no live-token split with
  // Swarm), 2 (HA) at the cutover (www-j934.9 / DESIGN §7).
  cloudflaredReplicas: number;
  // NFS server for the media share: NAS LAN IP by default; kubelet mounts the PV
  // from the node netns, which reaches the LAN on home-server (DESIGN 5b/5c, www-j934.17).
  nasNfsServer: string;
  // Per-service image digest pins from CI (name -> sha256:…); see ghcr().
  imageDigests?: ImageDigests;
  // Prod stack guard against rendering app Deployments with mutable :main images.
  requireImageDigestPins?: boolean;
  // Which cluster this program targets: {substrate:"orbstack"} (local-preview
  // default) or {substrate:"talos", nodeIp} (the deployed `home-server`
  // stack). Drives haTarget() below. See {@link SubstrateTarget} , a talos
  // target always carries its nodeIp, so this can't reach haTarget()'s talos
  // branch empty.
  target?: SubstrateTarget;
  // Decrypted vault from vault.ts (CC-k8t7).
  vault: Record<string, string>;
}

export interface ServicesResources {
  ghcrPullSecrets: k8s.core.v1.Secret[];
  haService: ExternalService | HostBackedService;
  pvcs: k8s.core.v1.PersistentVolumeClaim[];
  workloads: Workload[];
}

// The local (node-SSD) PVCs the workloads mount by claim name. Sizes are
// ENFORCED LVM reservations (ADR-0009) — hitting one is an online expansion,
// not an outage.
// Nothing claims local disk today (the plex-config claim went with Plex); the
// seam stays so the next node-SSD workload is a one-line addition.
const LOCAL_CLAIMS: { name: string; size: string }[] = [];

// The GHCR org account the imagePullSecret authenticates as (org-owned PAT).
const GHCR_USERNAME = "0x63616c";

// The `.dockerconfigjson` payload for the GHCR imagePullSecret: a docker
// config.json with a single `ghcr.io` auth entry. `auth` is base64("user:pat"),
// which docker/kubelet decode for the registry Basic-auth header (username and
// password are also carried plainly, mirroring what `docker login` writes).
//
// @public - pure JSON assembly, unit-tested in infra/test/services.test.ts.
export function composeGhcrDockerConfigJson(pat: string): string {
  const authB64 = Buffer.from(`${GHCR_USERNAME}:${pat}`).toString("base64");
  return JSON.stringify({
    auths: { "ghcr.io": { username: GHCR_USERNAME, password: pat, auth: authB64 } },
  });
}

/**
 * @public - the GHCR imagePullSecret (ESO dockerconfigjson), the HA headless
 * Service, and every app Workload. Consumed by the cluster program (www-j934.6).
 */
export function deployServices(args: ServicesArgs): ServicesResources {
  const {
    provider,
    namespaces,
    cloudflaredReplicas,
    nasNfsServer,
    imageDigests,
    requireImageDigestPins,
    target = { substrate: "orbstack" },
    vault,
  } = args;
  const opts = { provider };

  // GHCR pull secret: native dockerconfigjson Secret built from the PAT in vault.
  // The token is wrapped in pulumi.secret() so it's encrypted in Pulumi state.
  const pat = vault.GITHUB_PERSONAL_ACCESS_TOKEN__TOKEN;
  if (!pat) throw new Error("vault key GITHUB_PERSONAL_ACCESS_TOKEN__TOKEN not found");
  const dockerconfigjson = composeGhcrDockerConfigJson(pat);
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

  // `ha` -> the HA :8123 endpoint (api/worker reach `http://ha:8123`). The
  // Service SHAPE differs by substrate because the reachable target differs:
  //   - "orbstack" (mini, default): an ExternalName CNAME to the host's tailnet
  //     FQDN (a valid DNS name), delivered to the host HA socat via the
  //     locally-routed tailnet IP (www-j934.17).
  //   - "talos": HA is a hostNetwork pod in the `home-assistant` namespace,
  //     bound on the NODE's LAN IP. A cross-namespace selector Service can't
  //     reach it, and an ExternalName to the bare node IP is an invalid CNAME
  //     (kube-dns hands the IP back and api/worker get `bad address 'ha:8123'`).
  //     So front the fixed node IP with a selector-less ClusterIP + a manual
  //     EndpointSlice (HostBackedService) — the upstream idiom for a Service
  //     over a fixed IP. (Codified from the 2026-07-24 cutover live-patch, which
  //     replaced the malformed ExternalName by hand.)
  const haService =
    target.substrate === "talos"
      ? new HostBackedService(
          {
            name: "ha",
            hostIp: target.nodeIp,
            port: HA_PORT,
            provider,
            namespace: namespaces["control-center"],
          },
          opts,
        )
      : new ExternalService(
          {
            name: "ha",
            externalName: haTarget(target),
            provider,
            namespace: namespaces["control-center"],
          },
          opts,
        );

  // Local PVCs the workloads mount by claim name (web maps).
  const pvcs = LOCAL_CLAIMS.map(
    (c) =>
      new k8s.core.v1.PersistentVolumeClaim(
        c.name,
        {
          metadata: { name: c.name, namespace: namespaces["control-center"] },
          spec: {
            accessModes: ["ReadWriteOnce"],
            storageClassName: "local-lvm",
            resources: { requests: { storage: c.size } },
          },
        },
        opts,
      ),
  );

  const workloads = serviceSpecs({
    cloudflaredReplicas,
    nasNfsServer,
    imageDigests,
    requireImageDigestPins,
  }).map(
    ({ namespaceName, ...spec }) =>
      new Workload({ ...spec, provider, namespace: namespaces[namespaceName] }, opts),
  );

  return { ghcrPullSecrets, haService, pvcs, workloads };
}
