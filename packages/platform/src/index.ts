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

export type WebHostOptions = Readonly<{ host: string }>;

export type WebExposure =
  | Readonly<{
      kind: "public-web";
      policy: "public";
      target: ImplementedTargetName;
      host: string;
      hostname: string;
    }>
  | Readonly<{
      kind: "private-web";
      policy: "private";
      target: ImplementedTargetName;
      host: string;
      hostname: string;
      cloudflareAccess: true;
    }>
  | Readonly<{
      kind: "captive-portal-web";
      policy: "captive";
      target: ImplementedTargetName;
      host: string;
      hostname: string;
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

export function publicWeb(
  product: ProductIdentity,
  target: HomelabTarget,
  options: WebHostOptions,
): WebExposure {
  return {
    kind: "public-web",
    policy: "public",
    target: target.name,
    host: options.host,
    hostname: webHostname(product, target, options.host),
  };
}

export function privateWeb(
  product: ProductIdentity,
  target: HomelabTarget,
  options: WebHostOptions,
): WebExposure {
  return {
    kind: "private-web",
    policy: "private",
    target: target.name,
    host: options.host,
    hostname: webHostname(product, target, options.host),
    cloudflareAccess: true,
  };
}

export function captivePortalWeb(
  product: ProductIdentity,
  target: HomelabTarget,
  options: WebHostOptions,
): WebExposure {
  return {
    kind: "captive-portal-web",
    policy: "captive",
    target: target.name,
    host: options.host,
    hostname: webHostname(product, target, options.host),
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
