export const productSlugs = ["control-center", "captive-portal"] as const;

export type ProductSlug = (typeof productSlugs)[number];

export type DnsCode = "cc" | "cp";

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
  dnsCode: DnsCode;
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

const dnsCodes = {
  "control-center": "cc",
  "captive-portal": "cp",
} as const satisfies Record<ProductSlug, DnsCode>;

function assertNever(value: never): never {
  throw new Error(`Unhandled platform variant: ${String(value)}`);
}

export function defineProduct(slug: ProductSlug): ProductIdentity {
  const productPrefix = (component: string) => `${slug}-${component}`;

  return {
    slug,
    folder: `products/${slug}`,
    namespace: slug,
    dnsCode: dnsCodes[slug],
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

export const targetNames = ["homelab", "cloud"] as const;

export type TargetName = (typeof targetNames)[number];
export type ImplementedTargetName = "homelab";
export type UnsupportedTargetName = Exclude<TargetName, ImplementedTargetName>;

export type TargetCapabilities = Readonly<{
  certManager: boolean;
  cloudflareTunnel: boolean;
  cnpg: boolean;
  externalSecrets: boolean;
  k8s: boolean;
  nasBackups: boolean;
}>;

export type HomelabTarget = Readonly<{
  name: ImplementedTargetName;
  domain: "worldwidewebb.co";
  timezone: "America/Los_Angeles";
  nas: Readonly<{
    exportPath: "/volume1/Homelab";
    backupRootParts: readonly ["backups", "world-wide-webb"];
  }>;
  capabilities: TargetCapabilities;
}>;

export type TargetStatus =
  | Readonly<{ kind: "implemented"; target: HomelabTarget }>
  | Readonly<{
      kind: "unsupported";
      name: UnsupportedTargetName;
      reason: "Only homelab k8s is implemented in this migration.";
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

export function targetStatus(name: TargetName): TargetStatus {
  switch (name) {
    case "homelab":
      return { kind: "implemented", target: homelabTarget };
    case "cloud":
      return {
        kind: "unsupported",
        name,
        reason: "Only homelab k8s is implemented in this migration.",
      };
  }
  return assertNever(name);
}

// Hosts are flattened to a single label (`app--cc`), so the free root wildcard
// `*.worldwidewebb.co` always covers them. There is exactly one coverage model:
// the exact single host. (The old `product-wildcard` mode built a 2-label
// `*.cc.worldwidewebb.co` wildcard that only paid ACM could issue; it was removed
// with ACM, www-kbiy.)
export type ExactHostTlsCoverage = Readonly<{
  kind: "exact-host";
  hostname: string;
  dnsNames: readonly [string];
}>;

export type TlsCoverage = ExactHostTlsCoverage;

export type WebTlsRequirement = Readonly<{
  required: true;
  coverage: TlsCoverage;
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
      kind: "captive-portal-web";
      policy: "captive";
      target: ImplementedTargetName;
      host: string;
      hostname: string;
      tls: WebTlsRequirement;
      humanReview: Readonly<{
        required: true;
        reason: "Captive portal exposure changes UniFi, LAN forwarding, DNS, and TLS behavior.";
      }>;
    }>;

export type InternalServiceExposure = Readonly<{
  kind: "internal-service";
  policy: "internal";
  port: number;
}>;

function webHostname(product: ProductIdentity, target: HomelabTarget, host: string): string {
  // Flattened to a SINGLE label `<host>--<dnsCode>` (e.g. `app--cc`) so the free
  // Cloudflare Universal SSL `*.worldwidewebb.co` (one-label wildcard) covers it.
  // A dotted "app dot cc" host would be two labels deep and would need paid ACM.
  return `${host}--${product.dnsCode}.${target.domain}`;
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

export function privateWeb(
  product: ProductIdentity,
  target: HomelabTarget,
  options: WebHostOptions,
): WebExposure {
  const hostname = webHostname(product, target, options.host);

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

export function captivePortalWeb(
  product: ProductIdentity,
  target: HomelabTarget,
  options: WebHostOptions,
): WebExposure {
  const hostname = webHostname(product, target, options.host);

  return {
    kind: "captive-portal-web",
    policy: "captive",
    target: target.name,
    host: options.host,
    hostname,
    tls: webTlsRequirement(hostname),
    humanReview: {
      required: true,
      reason: "Captive portal exposure changes UniFi, LAN forwarding, DNS, and TLS behavior.",
    },
  };
}

export function internalService(options: { port: number }): InternalServiceExposure {
  return { kind: "internal-service", policy: "internal", port: options.port };
}

// The k8s namespace a service's target Secret lands in. Defaults to the owning
// product's namespace; only cloudflared varies (it lives in `platform`).
export type SecretNamespace = ProductSlug | "platform";

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

export type ControlCenterSecretUsageName =
  | "api"
  | "worker"
  | "media-worker"
  | "drizzle"
  | "cloudflared"
  | "portal-data-purge";

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
  apns: {
    keyId: secret("APNs Auth Key", "key id", "APNS_AUTH_KEY__KEY_ID"),
    teamId: secret("APNs Auth Key", "team id", "APNS_AUTH_KEY__TEAM_ID"),
    // Same shape as appStoreConnect.p8Content: the .p8 rides the item as a file
    // attachment, and the SOPS vault holds it base64-encoded under
    // APNS_AUTH_KEY__P8_CONTENT. pemToPkcs8() accepts armored PEM or bare base64.
    p8Content: secret("APNs Auth Key", "AuthKey_Z8CPKZ46G7.p8", "APNS_AUTH_KEY__P8_CONTENT"),
  },
  captivePortal: {
    postgresPassword: secret(
      "Captive Portal Postgres",
      "password",
      "CAPTIVE_PORTAL_POSTGRES__PASSWORD",
    ),
  },
  cloudflare: {
    tunnelToken: secret(
      "Cloudflare Tunnel evee-webhooks",
      "connector_token",
      "CLOUDFLARE_TUNNEL_EVEE_WEBHOOKS__CONNECTOR_TOKEN",
    ),
  },
  controlCenter: {
    postgresPassword: secret(
      "Control Center Postgres",
      "password",
      "CONTROL_CENTER_POSTGRES__PASSWORD",
    ),
  },
  drizzle: {
    masterpass: secret("Drizzle Gateway", "masterpass", "DRIZZLE_GATEWAY__MASTERPASS"),
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
    placeName: secret("Home Location", "place_name", "HOME_LOCATION__PLACE_NAME"),
    radiusMiles: secret("Home Location", "radius_miles", "HOME_LOCATION__RADIUS_MILES"),
  },
  openRouter: {
    apiKey: secret("OpenRouter", "credential", "OPENROUTER__CREDENTIAL"),
  },
  spotify: {
    clientId: secret("Spotify", "client_id", "SPOTIFY__CLIENT_ID"),
    clientSecret: secret("Spotify", "client_secret", "SPOTIFY__CLIENT_SECRET"),
    refreshToken: secret("Spotify", "refresh_token", "SPOTIFY__REFRESH_TOKEN"),
  },
  unifi: {
    localApiKey: secret("UniFi", "local_api_key", "UNIFI__LOCAL_API_KEY"),
  },
  wifiGuest: {
    password: secret("WiFi Guest Credentials", "password", "WIFI_GUEST_CREDENTIALS__PASSWORD"),
    ssid: secret("WiFi Guest Credentials", "ssid", "WIFI_GUEST_CREDENTIALS__SSID"),
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
  const apiSecrets = {
    HA_TOKEN: secretCatalog.homeAssistant.token,
    UNIFI_API_KEY: secretCatalog.unifi.localApiKey,
    WIFI_SSID: secretCatalog.wifiGuest.ssid,
    WIFI_PASSWORD: secretCatalog.wifiGuest.password,
    POSTGRES_PASSWORD: secretCatalog.controlCenter.postgresPassword,
    HOME_LAT: secretCatalog.homeLocation.lat,
    HOME_LON: secretCatalog.homeLocation.lon,
    HOME_PLACE_NAME: secretCatalog.homeLocation.placeName,
    HOME_RADIUS_MILES: secretCatalog.homeLocation.radiusMiles,
    SPOTIFY_CLIENT_ID: secretCatalog.spotify.clientId,
    SPOTIFY_CLIENT_SECRET: secretCatalog.spotify.clientSecret,
    SPOTIFY_REFRESH_TOKEN: secretCatalog.spotify.refreshToken,
    ASC_KEY_ID: secretCatalog.appStoreConnect.keyId,
    ASC_ISSUER_ID: secretCatalog.appStoreConnect.issuerId,
    ASC_KEY_CONTENT: secretCatalog.appStoreConnect.p8Content,
    // Deploys-tile poller. Only the worker reads it, but api/worker secret sets
    // are kept in lockstep (www-51hf.35), so it appears in both.
    GITHUB_ACTIONS_TOKEN: secretCatalog.github.ghcrPat,
    APNS_KEY_ID: secretCatalog.apns.keyId,
    APNS_TEAM_ID: secretCatalog.apns.teamId,
    APNS_KEY_CONTENT: secretCatalog.apns.p8Content,
  } as const;
  const workerSecrets = {
    HA_TOKEN: secretCatalog.homeAssistant.token,
    UNIFI_API_KEY: secretCatalog.unifi.localApiKey,
    WIFI_SSID: secretCatalog.wifiGuest.ssid,
    WIFI_PASSWORD: secretCatalog.wifiGuest.password,
    POSTGRES_PASSWORD: secretCatalog.controlCenter.postgresPassword,
    HOME_LAT: secretCatalog.homeLocation.lat,
    HOME_LON: secretCatalog.homeLocation.lon,
    HOME_PLACE_NAME: secretCatalog.homeLocation.placeName,
    HOME_RADIUS_MILES: secretCatalog.homeLocation.radiusMiles,
    SPOTIFY_CLIENT_ID: secretCatalog.spotify.clientId,
    SPOTIFY_CLIENT_SECRET: secretCatalog.spotify.clientSecret,
    SPOTIFY_REFRESH_TOKEN: secretCatalog.spotify.refreshToken,
    ASC_KEY_ID: secretCatalog.appStoreConnect.keyId,
    ASC_ISSUER_ID: secretCatalog.appStoreConnect.issuerId,
    ASC_KEY_CONTENT: secretCatalog.appStoreConnect.p8Content,
    // Deploys-tile poller. Only the worker reads it, but api/worker secret sets
    // are kept in lockstep (www-51hf.35), so it appears in both.
    GITHUB_ACTIONS_TOKEN: secretCatalog.github.ghcrPat,
    // worker runs the notify-queue cycle (media-worker is parked at 0), so it is
    // the process that actually signs the APNs JWT and sends the push.
    APNS_KEY_ID: secretCatalog.apns.keyId,
    APNS_TEAM_ID: secretCatalog.apns.teamId,
    APNS_KEY_CONTENT: secretCatalog.apns.p8Content,
  } as const;

  return {
    api: defineServiceSecretUsage(controlCenter, "api", apiSecrets),
    worker: defineServiceSecretUsage(controlCenter, "worker", workerSecrets),
    "media-worker": defineServiceSecretUsage(controlCenter, "media-worker", {
      POSTGRES_PASSWORD: secretCatalog.controlCenter.postgresPassword,
      OPENROUTER_API_KEY: secretCatalog.openRouter.apiKey,
      // media-worker runs the "notify" job handler (registerNotifyHandler), so it
      // is the only process that actually talks to APNs. api/worker just enqueue.
      APNS_KEY_ID: secretCatalog.apns.keyId,
      APNS_TEAM_ID: secretCatalog.apns.teamId,
      APNS_KEY_CONTENT: secretCatalog.apns.p8Content,
    }),
    drizzle: defineServiceSecretUsage(controlCenter, "drizzle", {
      MASTERPASS: secretCatalog.drizzle.masterpass,
      POSTGRES_PASSWORD: secretCatalog.controlCenter.postgresPassword,
    }),
    cloudflared: defineServiceSecretUsage(
      controlCenter,
      "cloudflared",
      { TUNNEL_TOKEN: secretCatalog.cloudflare.tunnelToken },
      { targetSecretName: "platform-secrets-cloudflared", namespaceName: "platform" },
    ),
    "portal-data-purge": defineServiceSecretUsage(controlCenter, "portal-data-purge", {
      POSTGRES_PASSWORD: secretCatalog.controlCenter.postgresPassword,
    }),
  };
}

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
    case "captive-portal":
      return secretCatalog.captivePortal.postgresPassword;
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
    storageClass: options.storageClass ?? "local-path",
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
  commandFeatures: Readonly<{
    compression: "gzip";
    dateFormat: "%Y%m%d";
    pipefail: true;
    passwordSource: "mounted-basic-auth-secret";
  }>;
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
    commandFeatures: {
      compression: "gzip",
      dateFormat: "%Y%m%d",
      pipefail: true,
      passwordSource: "mounted-basic-auth-secret",
    },
  };
}

export type ControlCenterServiceName =
  | "api"
  | "worker"
  | "media-worker"
  | "web"
  | "storybook"
  | "captive-portal"
  | "drizzle"
  | "cloudflared";

export type ProductServiceDeclaration<ServiceName extends string = ControlCenterServiceName> =
  Readonly<{
    service: ServiceName;
    workloadName: string;
    image: string;
    exposure: WebExposure | InternalServiceExposure | null;
    secretUsage?: ServiceSecretUsage;
  }>;

export type ControlCenterProductManifest = Readonly<{
  product: ProductIdentity;
  target: HomelabTarget;
  app: Readonly<{
    exposure: WebExposure;
    legacyHostname: "dashboard.worldwidewebb.co";
  }>;
  services: Readonly<Record<ControlCenterServiceName, ProductServiceDeclaration>>;
  secretUsages: Readonly<Record<ControlCenterSecretUsageName, ServiceSecretUsage>>;
  database: ProductDatabase;
  backup: DatabaseBackup;
}>;

export type CaptivePortalServiceName = "app" | "api";
export type CaptivePortalSecretUsageName = "api";

export type CaptivePortalProductManifest = Readonly<{
  product: ProductIdentity;
  target: HomelabTarget;
  app: Readonly<{
    exposure: WebExposure;
    legacyHostname: "captive-portal.worldwidewebb.co";
  }>;
  services: Readonly<
    Record<CaptivePortalServiceName, ProductServiceDeclaration<CaptivePortalServiceName>>
  >;
  secretUsages: Readonly<Record<CaptivePortalSecretUsageName, ServiceSecretUsage>>;
  database: ProductDatabase;
  retainedLegacyDatabases: readonly ProductDatabase[];
  backup: DatabaseBackup;
}>;

function mainImage(product: ProductIdentity, service: string): string {
  return `${product.imageRepository(service)}:main`;
}

export function controlCenterProductManifest(): ControlCenterProductManifest {
  const product = defineProduct("control-center");
  const target = homelabTarget;
  const secretUsages = controlCenterServiceSecretUsages();
  const database = defineProductDatabase(product, target, {
    authPassword: secretCatalog.controlCenter.postgresPassword,
    authSecretName: "cc-postgres-auth",
    clusterName: "control-center",
    rwServiceName: "control-center-rw",
    roServiceName: "control-center-ro",
    readServiceName: "control-center-r",
    size: "5Gi",
  });
  const backup = defineDatabaseBackup(database, target, {
    name: "pg-backup",
    nasSubPathParts: ["backups", "postgres"],
    schedule: "0 1 * * *",
  });
  const captivePortalProduct = defineProduct("captive-portal");

  return {
    product,
    target,
    app: {
      exposure: privateWeb(product, target, { host: "app" }),
      legacyHostname: "dashboard.worldwidewebb.co",
    },
    services: {
      api: {
        service: "api",
        workloadName: "api",
        image: mainImage(product, "api"),
        exposure: internalService({ port: 4201 }),
        secretUsage: secretUsages.api,
      },
      worker: {
        service: "worker",
        workloadName: "worker",
        image: mainImage(product, "worker"),
        exposure: null,
        secretUsage: secretUsages.worker,
      },
      "media-worker": {
        service: "media-worker",
        workloadName: "media-worker",
        image: mainImage(product, "media-worker"),
        exposure: null,
        secretUsage: secretUsages["media-worker"],
      },
      web: {
        service: "web",
        workloadName: "web",
        image: mainImage(product, "web"),
        exposure: privateWeb(product, target, { host: "app" }),
      },
      storybook: {
        service: "storybook",
        workloadName: "storybook",
        image: mainImage(product, "storybook"),
        exposure: privateWeb(product, target, { host: "storybook" }),
      },
      "captive-portal": {
        service: "captive-portal",
        workloadName: "captive-portal",
        image: mainImage(captivePortalProduct, "portal"),
        exposure: captivePortalWeb(captivePortalProduct, target, { host: "app" }),
      },
      drizzle: {
        service: "drizzle",
        workloadName: "drizzle",
        image: mainImage(product, "drizzle"),
        exposure: privateWeb(product, target, { host: "drizzle" }),
        secretUsage: secretUsages.drizzle,
      },
      cloudflared: {
        service: "cloudflared",
        workloadName: "cloudflared",
        image: "cloudflare/cloudflared:2025.10.1",
        exposure: null,
        secretUsage: secretUsages.cloudflared,
      },
    },
    secretUsages,
    database,
    backup,
  };
}

export function captivePortalProductManifest(): CaptivePortalProductManifest {
  const product = defineProduct("captive-portal");
  const target = homelabTarget;
  const appExposure = captivePortalWeb(product, target, { host: "app" });
  const database = defineProductDatabase(product, target, {
    authPassword: secretCatalog.captivePortal.postgresPassword,
    size: "2Gi",
  });
  const retainedLegacyDatabases = [
    defineProductDatabase(product, target, {
      authPassword: secretCatalog.captivePortal.postgresPassword,
      authSecretName: "captive-portal-postgres-auth",
      clusterName: "captive-portal",
      readServiceName: "captive-portal-r",
      roServiceName: "captive-portal-ro",
      rwServiceName: "captive-portal-rw",
      size: "2Gi",
    }),
  ];
  const backup = defineDatabaseBackup(database, target, {
    name: "captive-portal-pg-backup",
    schedule: "15 1 * * *",
  });
  const apiSecretUsage = defineServiceSecretUsage(product, "api", {
    POSTGRES_PASSWORD: secretCatalog.captivePortal.postgresPassword,
    UNIFI_API_KEY: secretCatalog.unifi.localApiKey,
    WIFI_PASSWORD: secretCatalog.wifiGuest.password,
    WIFI_SSID: secretCatalog.wifiGuest.ssid,
  });

  return {
    product,
    target,
    app: {
      exposure: appExposure,
      legacyHostname: "captive-portal.worldwidewebb.co",
    },
    services: {
      app: {
        service: "app",
        workloadName: "captive-portal",
        image: mainImage(product, "portal"),
        exposure: appExposure,
      },
      api: {
        service: "api",
        workloadName: product.serviceName("api"),
        image: mainImage(product, "api"),
        exposure: internalService({ port: 4211 }),
        secretUsage: apiSecretUsage,
      },
    },
    secretUsages: { api: apiSecretUsage },
    database,
    retainedLegacyDatabases,
    backup,
  };
}
