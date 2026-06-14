export const productSlugs = ["control-center", "captive-portal", "text-your-ex", "amp"] as const;

export type ProductSlug = (typeof productSlugs)[number];

export type DnsCode = "cc" | "cp" | "tye" | "amp";

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
  backupPathParts: (
    component: string,
  ) => readonly ["backups", "world-wide-webb", ProductSlug, string];
}>;

const dnsCodes = {
  "control-center": "cc",
  "captive-portal": "cp",
  "text-your-ex": "tye",
  amp: "amp",
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
    imageRepository: (component) => `ghcr.io/0x63616c/${slug}-${component}`,
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

export type TlsCoverageMode = "exact-host" | "product-wildcard";

export type ExactHostTlsCoverage = Readonly<{
  kind: "exact-host";
  hostname: string;
  dnsNames: readonly [string];
}>;

export type ProductWildcardTlsCoverage = Readonly<{
  kind: "product-wildcard";
  hostname: string;
  productHostnameSuffix: string;
  dnsNames: readonly [string];
}>;

export type TlsCoverage = ExactHostTlsCoverage | ProductWildcardTlsCoverage;

export type WebTlsRequirement = Readonly<{
  required: true;
  coverage: TlsCoverage;
}>;

export type WebHostOptions = Readonly<{ host: string; tlsCoverage?: TlsCoverageMode }>;

export type WebExposure =
  | Readonly<{
      kind: "public-web";
      policy: "public";
      target: ImplementedTargetName;
      host: string;
      hostname: string;
      tls: WebTlsRequirement;
    }>
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
  return `${host}.${product.dnsCode}.${target.domain}`;
}

function productHostnameSuffix(product: ProductIdentity, target: HomelabTarget): string {
  return `${product.dnsCode}.${target.domain}`;
}

function webTlsRequirement(
  product: ProductIdentity,
  target: HomelabTarget,
  hostname: string,
  mode: TlsCoverageMode = "exact-host",
): WebTlsRequirement {
  switch (mode) {
    case "exact-host":
      return {
        required: true,
        coverage: {
          kind: "exact-host",
          hostname,
          dnsNames: [hostname],
        },
      };
    case "product-wildcard": {
      const suffix = productHostnameSuffix(product, target);
      const wildcardHostname = `*.${suffix}`;

      return {
        required: true,
        coverage: {
          kind: "product-wildcard",
          hostname: wildcardHostname,
          productHostnameSuffix: suffix,
          dnsNames: [wildcardHostname],
        },
      };
    }
  }
  return assertNever(mode);
}

export function publicWeb(
  product: ProductIdentity,
  target: HomelabTarget,
  options: WebHostOptions,
): WebExposure {
  const hostname = webHostname(product, target, options.host);

  return {
    kind: "public-web",
    policy: "public",
    target: target.name,
    host: options.host,
    hostname,
    tls: webTlsRequirement(product, target, hostname, options.tlsCoverage),
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
    tls: webTlsRequirement(product, target, hostname, options.tlsCoverage),
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
    tls: webTlsRequirement(product, target, hostname, options.tlsCoverage),
    humanReview: {
      required: true,
      reason: "Captive portal exposure changes UniFi, LAN forwarding, DNS, and TLS behavior.",
    },
  };
}

export function internalService(options: { port: number }): InternalServiceExposure {
  return { kind: "internal-service", policy: "internal", port: options.port };
}

export type SecretCatalogEntry = Readonly<{
  item: string;
  field: string;
  remoteRef: string;
  opPath: string;
}>;

export type ServiceSecretUsage = Readonly<{
  product: ProductSlug;
  service: string;
  mountPath: "/run/secrets";
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

function opSecret(item: string, field: string): SecretCatalogEntry {
  return {
    item,
    field,
    remoteRef: `${item}/${field}`,
    opPath: `op://Homelab/${item}/${field}`,
  };
}

export const secretCatalog = {
  cloudflare: {
    tunnelToken: opSecret("Cloudflare Tunnel evee-webhooks", "connector_token"),
  },
  controlCenter: {
    postgresPassword: opSecret("Control Center Postgres", "password"),
  },
  drizzle: {
    masterpass: opSecret("Drizzle Gateway", "masterpass"),
  },
  github: {
    ghcrPat: opSecret("GitHub Personal Access Token", "token"),
  },
  homeAssistant: {
    token: opSecret("Home Assistant Token", "credential"),
  },
  homeLocation: {
    lat: opSecret("Home Location", "lat"),
    lon: opSecret("Home Location", "lon"),
    placeName: opSecret("Home Location", "place_name"),
    radiusMiles: opSecret("Home Location", "radius_miles"),
  },
  openRouter: {
    apiKey: opSecret("OpenRouter", "credential"),
  },
  resend: {
    apiKey: opSecret("Resend", "credential"),
    fromAddress: opSecret("Resend", "from-address"),
  },
  spotify: {
    clientId: opSecret("Spotify", "client_id"),
    clientSecret: opSecret("Spotify", "client_secret"),
    refreshToken: opSecret("Spotify", "refresh_token"),
  },
  unifi: {
    localApiKey: opSecret("UniFi", "local_api_key"),
  },
  wifiGuest: {
    password: opSecret("WiFi Guest Credentials", "password"),
    ssid: opSecret("WiFi Guest Credentials", "ssid"),
  },
} as const;

export function defineServiceSecretUsage(
  product: ProductIdentity,
  service: string,
  secrets: Readonly<Record<string, SecretCatalogEntry>>,
  options: { targetSecretName?: string } = {},
): ServiceSecretUsage {
  return {
    product: product.slug,
    service,
    mountPath: "/run/secrets",
    targetSecretName: options.targetSecretName ?? `${product.slug}-secrets-${service}`,
    secrets,
  };
}

export function serviceSecretMap(
  usages: Readonly<Record<string, ServiceSecretUsage>>,
): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  for (const [service, usage] of Object.entries(usages)) {
    result[service] = Object.fromEntries(
      Object.entries(usage.secrets).map(([name, entry]) => [name, entry.remoteRef]),
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
    RESEND_API_KEY: secretCatalog.resend.apiKey,
    RESEND_FROM: secretCatalog.resend.fromAddress,
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
  } as const;

  return {
    api: defineServiceSecretUsage(controlCenter, "api", apiSecrets, {
      targetSecretName: "cc-secrets-api",
    }),
    worker: defineServiceSecretUsage(controlCenter, "worker", workerSecrets, {
      targetSecretName: "cc-secrets-worker",
    }),
    "media-worker": defineServiceSecretUsage(
      controlCenter,
      "media-worker",
      {
        POSTGRES_PASSWORD: secretCatalog.controlCenter.postgresPassword,
        OPENROUTER_API_KEY: secretCatalog.openRouter.apiKey,
      },
      { targetSecretName: "cc-secrets-media-worker" },
    ),
    drizzle: defineServiceSecretUsage(
      controlCenter,
      "drizzle",
      {
        MASTERPASS: secretCatalog.drizzle.masterpass,
        POSTGRES_PASSWORD: secretCatalog.controlCenter.postgresPassword,
      },
      { targetSecretName: "cc-secrets-drizzle" },
    ),
    cloudflared: defineServiceSecretUsage(
      controlCenter,
      "cloudflared",
      { TUNNEL_TOKEN: secretCatalog.cloudflare.tunnelToken },
      { targetSecretName: "cc-secrets-cloudflared" },
    ),
    "portal-data-purge": defineServiceSecretUsage(
      controlCenter,
      "portal-data-purge",
      { POSTGRES_PASSWORD: secretCatalog.controlCenter.postgresPassword },
      { targetSecretName: "cc-secrets-portal-data-purge" },
    ),
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
  authSecretName: string;
  auth: Readonly<{
    kind: "database-owned-basic-auth";
    secretName: string;
  }>;
  storageClass: string;
  size: string;
  resources: DatabaseResources;
}>;

export type ProductDatabaseOptions = Readonly<{
  size: string;
  authSecretName?: string;
  owner?: string;
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

export function defineProductDatabase(
  product: ProductIdentity,
  target: HomelabTarget,
  options: ProductDatabaseOptions,
): ProductDatabase {
  const authSecretName = options.authSecretName ?? `${product.slug}-postgres-auth`;

  return {
    product: product.slug,
    target: target.name,
    clusterName: product.slug,
    databaseName: databaseNameFor(product),
    owner: options.owner ?? "postgres",
    rwServiceName: `${product.slug}-rw`,
    authSecretName,
    auth: { kind: "database-owned-basic-auth", secretName: authSecretName },
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

export type AmpServiceName = "app";

export type AmpProductManifest = Readonly<{
  product: ProductIdentity;
  target: HomelabTarget;
  app: Readonly<{
    exposure: WebExposure;
  }>;
  services: Readonly<Record<AmpServiceName, ProductServiceDeclaration<AmpServiceName>>>;
  secretUsages: Readonly<Record<string, never>>;
  database: null;
  backup: null;
}>;

function mainImage(product: ProductIdentity, service: string): string {
  return `${product.imageRepository(service)}:main`;
}

export function controlCenterProductManifest(): ControlCenterProductManifest {
  const product = defineProduct("control-center");
  const target = homelabTarget;
  const secretUsages = controlCenterServiceSecretUsages();
  const database = defineProductDatabase(product, target, {
    authSecretName: "cc-postgres-auth",
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
        image: mainImage(product, "captive-portal"),
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

export function ampProductManifest(): AmpProductManifest {
  const product = defineProduct("amp");
  const target = homelabTarget;
  const appExposure = privateWeb(product, target, { host: "app" });

  return {
    product,
    target,
    app: {
      exposure: appExposure,
    },
    services: {
      app: {
        service: "app",
        workloadName: product.serviceName("app"),
        image: mainImage(product, "app"),
        exposure: appExposure,
      },
    },
    secretUsages: {},
    database: null,
    backup: null,
  };
}
