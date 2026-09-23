// crypto.randomUUID is present in every real runtime this repo ships to
// (browser webview, Bun, Node), but not always in test doubles (older jsdom).
// getRandomValues is far more widely implemented, so it is the
// fallback — not Math.random, which CodeQL (rightly) flags as insecure
// randomness for anything id-shaped.
function randomHex(length: number): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replaceAll("-", "").slice(0, length);
  }
  const bytes = crypto.getRandomValues(new Uint8Array(Math.ceil(length / 2)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, length);
}

/**
 * Mint a Stripe-style `prefix_<id>`. Without `length`, the id is a full
 * `crypto.randomUUID()` (36 chars incl. dashes). With `length`, it is that
 * many hex characters of a de-dashed UUID — for ids that also need to fit a
 * shorter validation pattern (e.g. an API's `^prefix_[0-9a-z]{1,32}$`).
 */
export function genId(prefix: string, options?: { length?: number }): string {
  const { length } = options ?? {};
  if (length === undefined) {
    const uuid =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : randomHex(32);
    return `${prefix}_${uuid}`;
  }
  return `${prefix}_${randomHex(length)}`;
}

export const productSlugs = ["control-center"] as const;

export type ProductSlug = (typeof productSlugs)[number];

export type ProductLabels = Readonly<{
  "app.kubernetes.io/component": string;
  "app.kubernetes.io/name": ProductSlug;
  "app.kubernetes.io/part-of": "world-wide-webb";
  "worldwidewebb.co/product": ProductSlug;
}>;

export type ProductIdentity = Readonly<{
  slug: ProductSlug;
  folder: `products/${ProductSlug}`;
  namespace: ProductSlug;
  imageNamespace: ProductSlug;
  labels: (component: string) => ProductLabels;
  pulumiName: (component: string) => string;
  serviceName: (component: string) => string;
  imageRepository: (component: string) => string;
  imageDigestKey: (component: string) => string;
  backupPathParts: (
    component: string,
  ) => readonly ["backups", "world-wide-webb", ProductSlug, string];
}>;

function assertNever(value: never): never {
  throw new Error(`Unhandled platform variant: ${String(value)}`);
}

export function defineProduct(slug: ProductSlug): ProductIdentity {
  const productPrefix = (component: string) => `${slug}-${component}`;

  return {
    slug,
    folder: `products/${slug}`,
    namespace: slug,
    imageNamespace: slug,
    labels: (component) => ({
      "app.kubernetes.io/component": component,
      "app.kubernetes.io/name": slug,
      "app.kubernetes.io/part-of": "world-wide-webb",
      "worldwidewebb.co/product": slug,
    }),
    pulumiName: productPrefix,
    serviceName: productPrefix,
    imageRepository: (component) => `ghcr.io/0x63616c/www-${slug}-${component}`,
    imageDigestKey: productPrefix,
    backupPathParts: (component) => ["backups", "world-wide-webb", slug, component],
  };
}

export type ImplementedTargetName = "homelab";

export type HomelabTarget = Readonly<{
  name: ImplementedTargetName;
  domain: "worldwidewebb.co";
  timezone: "America/Los_Angeles";
  nas: Readonly<{
    exportPath: "/volume1/Homelab";
    backupRootParts: readonly ["backups", "world-wide-webb"];
  }>;
  // Inlined (was the separately-exported TargetCapabilities type): homelab is
  // the only implemented target, so a named plurality type here had exactly
  // one member and 0 external consumers.
  capabilities: Readonly<{
    certManager: boolean;
    cloudflareTunnel: boolean;
    cnpg: boolean;
    externalSecrets: boolean;
    k8s: boolean;
    nasBackups: boolean;
  }>;
}>;

export const implementedTargetNames = [
  "homelab",
] as const satisfies readonly ImplementedTargetName[];

export const homelabTarget = {
  name: "homelab",
  domain: "worldwidewebb.co",
  timezone: "America/Los_Angeles",
  nas: {
    exportPath: "/volume1/Homelab",
    backupRootParts: ["backups", "world-wide-webb"],
  },
  capabilities: {
    certManager: true,
    cloudflareTunnel: true,
    cnpg: true,
    externalSecrets: true,
    k8s: true,
    nasBackups: true,
  },
} as const satisfies HomelabTarget;

export function defineTarget(name: ImplementedTargetName): HomelabTarget {
  switch (name) {
    case "homelab":
      return homelabTarget;
  }
  return assertNever(name);
}

// Web hosts are a single label under the zone (`app.worldwidewebb.co`), so the
// free root wildcard `*.worldwidewebb.co` always covers them. There is exactly
// one coverage model: the exact single host. (The old `product-wildcard` mode
// built a 2-label `*.cc.worldwidewebb.co` wildcard that only paid ACM could
// issue; it was removed with ACM, www-kbiy.) Inlined below (was the
// separately-exported TlsCoverage/ExactHostTlsCoverage types): a plurality
// type with exactly one member and 0 external consumers.
export type WebTlsRequirement = Readonly<{
  required: true;
  coverage: Readonly<{
    kind: "exact-host";
    hostname: string;
    dnsNames: readonly [string];
  }>;
}>;

export type WebHostOptions = Readonly<{ host: string }>;

export type WebExposure =
  | Readonly<{
      kind: "private-web";
      policy: "private";
      target: ImplementedTargetName;
      host: string;
      hostname: string;
      tls: WebTlsRequirement;
      cloudflareAccess: true;
    }>
  | Readonly<{
      // A host a third party must be able to POST to from the public internet,
      // so it is deliberately NOT Access-gated — the service behind it owns its
      // own auth (e.g. an HMAC over the request body); Cloudflare is not the
      // boundary. No current manifest entry uses this kind (the one past
      // consumer, an inbound webhook receiver, was deleted by The
      // Simplification), but the variant and its test coverage stay: never
      // reach for this to "make a page easier to load", and adding a real
      // public host is a security decision each time, not a default.
      kind: "public-web";
      policy: "public";
      target: ImplementedTargetName;
      host: string;
      hostname: string;
      tls: WebTlsRequirement;
      cloudflareAccess: false;
    }>;

export type InternalServiceExposure = Readonly<{
  kind: "internal-service";
  policy: "internal";
  port: number;
}>;

function webHostname(target: HomelabTarget, host: string): string {
  // A SINGLE label under the zone (e.g. `app.worldwidewebb.co`) so the free
  // Cloudflare Universal SSL `*.worldwidewebb.co` (one-label wildcard) covers it.
  // A dotted "app dot cc" host would be two labels deep and would need paid ACM.
  return `${host}.${target.domain}`;
}

function webTlsRequirement(hostname: string): WebTlsRequirement {
  return {
    required: true,
    coverage: {
      kind: "exact-host",
      hostname,
      dnsNames: [hostname],
    },
  };
}

export function privateWeb(target: HomelabTarget, options: WebHostOptions): WebExposure {
  const hostname = webHostname(target, options.host);

  return {
    kind: "private-web",
    policy: "private",
    target: target.name,
    host: options.host,
    hostname,
    tls: webTlsRequirement(hostname),
    cloudflareAccess: true,
  };
}

/**
 * A publicly reachable, NON-Access-gated tunnel host. See the `public-web`
 * variant of {@link WebExposure} — using this means the service behind it owns
 * its own authentication.
 */
export function publicWeb(target: HomelabTarget, options: WebHostOptions): WebExposure {
  const hostname = webHostname(target, options.host);

  return {
    kind: "public-web",
    policy: "public",
    target: target.name,
    host: options.host,
    hostname,
    tls: webTlsRequirement(hostname),
    cloudflareAccess: false,
  };
}

export function internalService(options: { port: number }): InternalServiceExposure {
  return { kind: "internal-service", policy: "internal", port: options.port };
}

// The k8s namespace a service's target Secret lands in. Defaults to the owning
// product's namespace; only cloudflared varies (it lives in `cloudflare`).
export type SecretNamespace = ProductSlug | "cloudflare";

// A single declared secret. `vaultKey` is the operative reference: the SOPS
// ITEM__FIELD key in secrets/vault.yaml that vault.ts/eso.ts resolve (CC-k8t7
// replaced 1Password+ESO with SOPS+age). `item`/`field` are retained purely as
// provenance/audit metadata (which 1Password Homelab item the value came from);
// they are NOT a source of truth for the vault key — e.g. the App Store Connect
// .p8 rides the item as an `AuthKey_*.p8` file attachment but its vault key is
// APP_STORE_CONNECT_API__P8_CONTENT, so the mapping is stated explicitly here.
export type SecretCatalogEntry = Readonly<{
  item: string;
  field: string;
  vaultKey: string;
}>;

export type ServiceSecretUsage = Readonly<{
  product: ProductSlug;
  service: string;
  mountPath: "/run/secrets";
  namespaceName: SecretNamespace;
  targetSecretName: string;
  secrets: Readonly<Record<string, SecretCatalogEntry>>;
}>;

export type ControlCenterSecretUsageName = "api" | "worker" | "cloudflared";

function secret(item: string, field: string, vaultKey: string): SecretCatalogEntry {
  return { item, field, vaultKey };
}

export const secretCatalog = {
  appStoreConnect: {
    keyId: secret("App Store Connect API", "key id", "APP_STORE_CONNECT_API__KEY_ID"),
    issuerId: secret("App Store Connect API", "issuer id", "APP_STORE_CONNECT_API__ISSUER_ID"),
    // The .p8 rides the item as the AuthKey_*.p8 file attachment; in the SOPS
    // vault it is APP_STORE_CONNECT_API__P8_CONTENT (same item CI's fastlane uses).
    p8Content: secret(
      "App Store Connect API",
      "AuthKey_TJ8M46SFSQ.p8",
      "APP_STORE_CONNECT_API__P8_CONTENT",
    ),
  },
  cloudflare: {
    // The project-owned `world-wide-webb` tunnel, created by the infra/cloudflare
    // Pulumi stack. Its value is that stack's `managedTunnelToken` output, copied
    // here rather than read via StackReference (the k8s deploy runs in CI, which
    // has no access to the hand-applied cloudflare stack's state).
    managedTunnelToken: secret(
      "Cloudflare Tunnel world-wide-webb",
      "connector_token",
      "CLOUDFLARE_TUNNEL_WORLD_WIDE_WEBB__CONNECTOR_TOKEN",
    ),
  },
  controlCenter: {
    postgresPassword: secret(
      "Control Center Postgres",
      "password",
      "CONTROL_CENTER_POSTGRES__PASSWORD",
    ),
  },
  github: {
    ghcrPat: secret("GitHub Personal Access Token", "token", "GITHUB_PERSONAL_ACCESS_TOKEN__TOKEN"),
  },
  homeAssistant: {
    token: secret("Home Assistant Token", "credential", "HOME_ASSISTANT_TOKEN__CREDENTIAL"),
  },
  homeLocation: {
    lat: secret("Home Location", "lat", "HOME_LOCATION__LAT"),
    lon: secret("Home Location", "lon", "HOME_LOCATION__LON"),
  },
  // The guest network the board's Wi-Fi QR tile encodes (features/wifi). Vault
  // item + keys match the pre-Simplification "WiFi Guest Wifi" entry so the
  // values restore from vault history under the same names.
  wifiGuest: {
    ssid: secret("WiFi Guest Wifi", "ssid", "WIFI_GUEST_WIFI_SSID"),
    password: secret("WiFi Guest Wifi", "password", "WIFI_GUEST_WIFI_PASSWORD"),
  },
} as const;

export function defineServiceSecretUsage(
  product: ProductIdentity,
  service: string,
  secrets: Readonly<Record<string, SecretCatalogEntry>>,
  options: { targetSecretName?: string; namespaceName?: SecretNamespace } = {},
): ServiceSecretUsage {
  return {
    product: product.slug,
    service,
    mountPath: "/run/secrets",
    namespaceName: options.namespaceName ?? product.namespace,
    targetSecretName: options.targetSecretName ?? `${product.slug}-secrets-${service}`,
    secrets,
  };
}

// Reshape usages into the flat service -> { envName: vaultKey } view infra
// consumes (secrets-map.ts SERVICE_SECRETS). Generic over the usage-key set so
// the caller's literal service keys survive into the result type.
export function serviceSecretMap<K extends string>(
  usages: Readonly<Record<K, ServiceSecretUsage>>,
): Record<K, Record<string, string>> {
  const result = {} as Record<K, Record<string, string>>;
  for (const [service, usage] of Object.entries(usages) as [K, ServiceSecretUsage][]) {
    result[service] = Object.fromEntries(
      Object.entries(usage.secrets).map(([name, entry]) => [name, entry.vaultKey]),
    );
  }
  return result;
}

export function controlCenterServiceSecretUsages(): Record<
  ControlCenterSecretUsageName,
  ServiceSecretUsage
> {
  const controlCenter = defineProduct("control-center");
  // api and worker share one base set (pinned by secrets.test.ts). A secret
  // only one of them reads is a delta spread onto that service alone, never
  // added to both: the guest Wi-Fi pair below is api-only because only the
  // wifi feature's tRPC slice reads it (the worker has no Wi-Fi cycle).
  const apiWorkerSharedSecrets = {
    HA_TOKEN: secretCatalog.homeAssistant.token,
    POSTGRES_PASSWORD: secretCatalog.controlCenter.postgresPassword,
    HOME_LAT: secretCatalog.homeLocation.lat,
    HOME_LON: secretCatalog.homeLocation.lon,
  } as const;

  return {
    api: defineServiceSecretUsage(controlCenter, "api", {
      ...apiWorkerSharedSecrets,
      WIFI_GUEST_SSID: secretCatalog.wifiGuest.ssid,
      WIFI_GUEST_PASSWORD: secretCatalog.wifiGuest.password,
    }),
    worker: defineServiceSecretUsage(controlCenter, "worker", apiWorkerSharedSecrets),
    cloudflared: defineServiceSecretUsage(
      controlCenter,
      "cloudflared",
      { TUNNEL_TOKEN: secretCatalog.cloudflare.managedTunnelToken },
      { targetSecretName: "cloudflare-secrets-cloudflared", namespaceName: "cloudflare" },
    ),
  };
}

// `limits` deliberately has no `cpu` key (only `requests` does) — same
// asymmetry as infra/src/component.ts's ResourceSpec, and for the same reason
// (#87): CPU is compressible, so a CPU limit only throttles under CFS quota
// with no benefit (https://home.robusta.dev/blog/stop-using-cpu-limits),
// while memory is incompressible and needs the limit to bound OOM risk.
// requests.cpu alone gives fair-share scheduling. Do not add a `cpu` field to
// `limits` to "match" requests — the asymmetry is intentional.
export type DatabaseResources = Readonly<{
  limits: Readonly<{ memory: string }>;
  requests: Readonly<{ cpu: string; memory: string }>;
}>;

export type ProductDatabase = Readonly<{
  product: ProductSlug;
  target: ImplementedTargetName;
  clusterName: string;
  databaseName: string;
  owner: string;
  rwServiceName: string;
  roServiceName: string;
  readServiceName: string;
  authSecretName: string;
  auth: Readonly<{
    kind: "database-owned-basic-auth";
    secretName: string;
    password: SecretCatalogEntry;
  }>;
  storageClass: string;
  size: string;
  resources: DatabaseResources;
}>;

export type ProductDatabaseOptions = Readonly<{
  size: string;
  authPassword?: SecretCatalogEntry;
  authSecretName?: string;
  clusterName?: string;
  owner?: string;
  rwServiceName?: string;
  roServiceName?: string;
  readServiceName?: string;
  storageClass?: string;
  resources?: DatabaseResources;
}>;

const defaultDatabaseResources = {
  limits: { memory: "768Mi" },
  requests: { cpu: "500m", memory: "384Mi" },
} as const satisfies DatabaseResources;

function databaseNameFor(product: ProductIdentity): string {
  return product.slug.replaceAll("-", "_");
}

function databasePasswordFor(product: ProductIdentity): SecretCatalogEntry {
  switch (product.slug) {
    case "control-center":
      return secretCatalog.controlCenter.postgresPassword;
  }
  return assertNever(product.slug);
}

export function defineProductDatabase(
  product: ProductIdentity,
  target: HomelabTarget,
  options: ProductDatabaseOptions,
): ProductDatabase {
  const clusterName = options.clusterName ?? "postgres";
  const authSecretName = options.authSecretName ?? "postgres-auth";

  return {
    product: product.slug,
    target: target.name,
    clusterName,
    databaseName: databaseNameFor(product),
    owner: options.owner ?? "postgres",
    rwServiceName: options.rwServiceName ?? `${clusterName}-rw`,
    roServiceName: options.roServiceName ?? `${clusterName}-ro`,
    readServiceName: options.readServiceName ?? `${clusterName}-r`,
    authSecretName,
    auth: {
      kind: "database-owned-basic-auth",
      secretName: authSecretName,
      password: options.authPassword ?? databasePasswordFor(product),
    },
    storageClass: options.storageClass ?? "local-lvm",
    size: options.size,
    resources: options.resources ?? defaultDatabaseResources,
  };
}

export type DatabaseBackup = Readonly<{
  kind: "postgres-logical-backup";
  required: true;
  product: ProductSlug;
  target: ImplementedTargetName;
  name: string;
  schedule: string;
  image: "ghcr.io/cloudnative-pg/postgresql:18";
  databaseName: string;
  owner: string;
  serviceHost: string;
  authSecretName: string;
  authMountPath: "/run/pgauth";
  backupMountPath: "/backup";
  nasExportPath: string;
  nasSubPath: string;
  filenamePrefix: string;
  // Was the separately-exported `commandFeatures` object (compression/pipefail/
  // passwordSource always the same 3 literals, 0 external consumers);
  // dateFormat is the only field infra/src/crons.ts actually reads, so it is
  // now a flat field instead of a nested single-shape plurality type.
  dateFormat: "%Y%m%d";
}>;

export type DatabaseBackupOptions = Readonly<{
  name?: string;
  schedule?: string;
  nasSubPathParts?: readonly string[];
}>;

export function defineDatabaseBackup(
  database: ProductDatabase,
  target: HomelabTarget,
  options: DatabaseBackupOptions = {},
): DatabaseBackup {
  const nasSubPathParts = options.nasSubPathParts ?? [
    ...target.nas.backupRootParts,
    database.product,
    "postgres",
  ];

  return {
    kind: "postgres-logical-backup",
    required: true,
    product: database.product,
    target: target.name,
    name: options.name ?? `${database.product}-pg-backup`,
    schedule: options.schedule ?? "0 1 * * *",
    image: "ghcr.io/cloudnative-pg/postgresql:18",
    databaseName: database.databaseName,
    owner: database.owner,
    serviceHost: database.rwServiceName,
    authSecretName: database.authSecretName,
    authMountPath: "/run/pgauth",
    backupMountPath: "/backup",
    nasExportPath: target.nas.exportPath,
    nasSubPath: nasSubPathParts.join("/"),
    filenamePrefix: `${database.databaseName}-`,
    dateFormat: "%Y%m%d",
  };
}

export type ControlCenterServiceName = "api" | "worker" | "web" | "manage" | "cloudflared";

// Was `{ service, workloadName, image, exposure, secretUsage? }`: workloadName
// and image had 0 external consumers (infra/src/services.ts re-derives both
// independently via ProductIdentity.serviceName/imageRepository) and the
// generic ServiceName param had no second product left to serve, so the type
// is control-center-only now.
export type ProductServiceDeclaration = Readonly<{
  service: ControlCenterServiceName;
  exposure: WebExposure | InternalServiceExposure | null;
  secretUsage?: ServiceSecretUsage;
}>;

export type ControlCenterProductManifest = Readonly<{
  product: ProductIdentity;
  target: HomelabTarget;
  app: Readonly<{
    exposure: WebExposure;
  }>;
  // The Grafana web UI (#209). Same story again: it runs in the
  // `observability` namespace from an upstream image (infra/src/observability/)
  // rather than as a control-center workload, but it does have a hostname on
  // the tunnel behind Access, and hostnames are owned here rather than beside
  // the workload that answers on them.
  grafana: Readonly<{
    exposure: WebExposure;
  }>;
  // Home Assistant (#75/#237): runs as the `ha` ExternalName Service in the
  // control-center namespace (infra/src/services.ts), not a control-center
  // workload, but gets a hostname on the tunnel behind Access same as Grafana.
  ha: Readonly<{
    exposure: WebExposure;
  }>;
  // The Synology DSM: a LAN appliance manage frame (ADR-0010), not a workload
  // of ours at all — it's a box on the LAN — but it gets a tunnel hostname
  // behind Access, and hostnames are owned here. Its origin is HTTPS with a
  // self-signed cert, so the ingress rule that points at it carries
  // `noTlsVerify` (infra/cloudflare/src/routes.ts): an iframe cannot click
  // through a certificate warning, so that is required rather than cosmetic.
  dsm: Readonly<{
    exposure: WebExposure;
  }>;
  services: Readonly<Record<ControlCenterServiceName, ProductServiceDeclaration>>;
  secretUsages: Readonly<Record<ControlCenterSecretUsageName, ServiceSecretUsage>>;
  database: ProductDatabase;
  backup: DatabaseBackup;
}>;

export function controlCenterProductManifest(): ControlCenterProductManifest {
  const product = defineProduct("control-center");
  const target = homelabTarget;
  const secretUsages = controlCenterServiceSecretUsages();
  const database = defineProductDatabase(product, target, {
    authPassword: secretCatalog.controlCenter.postgresPassword,
    authSecretName: "cc-postgres-auth",
    clusterName: "control-center-postgres",
    // Enforced size (ADR-0009): 1.2GB actual + WAL headroom; expansion is a
    // one-line edit, so honest-but-modest.
    size: "10Gi",
  });
  const backup = defineDatabaseBackup(database, target, {
    name: "pg-backup",
    nasSubPathParts: ["backups", "postgres"],
    schedule: "0 1 * * *",
  });

  return {
    product,
    target,
    app: {
      exposure: privateWeb(target, { host: "app" }),
    },
    grafana: {
      // Single label under the zone, so Universal SSL's one-label wildcard
      // covers it (see webHostname).
      exposure: privateWeb(target, { host: "grafana" }),
    },
    ha: {
      // Single label under the zone, so Universal SSL's one-label wildcard
      // covers it (see webHostname).
      exposure: privateWeb(target, { host: "ha" }),
    },
    dsm: {
      exposure: privateWeb(target, { host: "dsm" }),
    },
    services: {
      api: {
        service: "api",
        exposure: internalService({ port: 4201 }),
        secretUsage: secretUsages.api,
      },
      worker: {
        service: "worker",
        exposure: null,
        secretUsage: secretUsages.worker,
      },
      web: {
        service: "web",
        exposure: privateWeb(target, { host: "app" }),
      },
      // The management plane (ADR-0010). A static nginx bundle like `web`, with
      // no api, no database and no secrets — Cloudflare Access is its only gate,
      // and every tool it frames authenticates for itself.
      manage: {
        service: "manage",
        // Single label under the zone, so Universal SSL's one-label wildcard
        // covers it (see webHostname).
        exposure: privateWeb(target, { host: "manage" }),
      },
      cloudflared: {
        service: "cloudflared",
        exposure: null,
        secretUsage: secretUsages.cloudflared,
      },
    },
    secretUsages,
    database,
    backup,
  };
}
