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

export type ProductIdentity = Readonly<{
  slug: ProductSlug;
}>;

function assertNever(value: never): never {
  throw new Error(`Unhandled platform variant: ${String(value)}`);
}

export function defineProduct(slug: ProductSlug): ProductIdentity {
  return { slug };
}

export type ImplementedTargetName = "homelab";

export type HomelabTarget = Readonly<{
  name: ImplementedTargetName;
  domain: "worldwidewebb.co";
  timezone: "America/Los_Angeles";
  nas: Readonly<{
    exportPath: "/volume1/Homelab";
    backupRootParts: readonly ["backups", "mac-mini"];
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
    backupRootParts: ["backups", "mac-mini"],
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

// A single declared secret. `vaultKey` is the operative reference: the SOPS
// ITEM__FIELD key in secrets/vault.yaml that vault hydration resolves (CC-k8t7
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
  homeAssistant: {
    token: secret("Home Assistant Token", "credential", "HOME_ASSISTANT_TOKEN__CREDENTIAL"),
  },
  alarms: {
    apiToken: secret("Panel Alarms", "token", "PANEL_ALARMS__TOKEN"),
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
): ServiceSecretUsage {
  return {
    product: product.slug,
    service,
    mountPath: "/run/secrets",
    secrets,
  };
}

// Reshape usages into the flat service -> { envName: vaultKey } hydration map. Generic over the usage-key set so
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
  // added to both.
  const apiWorkerSharedSecrets = {
    HA_TOKEN: secretCatalog.homeAssistant.token,
    POSTGRES_PASSWORD: secretCatalog.controlCenter.postgresPassword,
    HOME_LAT: secretCatalog.homeLocation.lat,
    HOME_LON: secretCatalog.homeLocation.lon,
  } as const;

  return {
    // api-only delta: the guest Wi-Fi pair feeds the Wi-Fi QR tile's api
    // query (features/wifi); the worker never reads it.
    api: defineServiceSecretUsage(controlCenter, "api", {
      ...apiWorkerSharedSecrets,
      WIFI_GUEST_SSID: secretCatalog.wifiGuest.ssid,
      WIFI_GUEST_PASSWORD: secretCatalog.wifiGuest.password,
      ALARM_API_TOKEN: secretCatalog.alarms.apiToken,
    }),
    worker: defineServiceSecretUsage(controlCenter, "worker", apiWorkerSharedSecrets),
    cloudflared: defineServiceSecretUsage(controlCenter, "cloudflared", {
      TUNNEL_TOKEN: secretCatalog.cloudflare.managedTunnelToken,
    }),
  };
}

export type ControlCenterServiceName = "api" | "worker" | "web" | "cloudflared";

// Logical app surfaces and secret usage. These are not separate containers:
// the root Dockerfile serves API, web and workers in one process.
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
  // Home Assistant runs in the mini's bridged Colima VM and keeps its
  // existing tunnel hostname and Access policy.
  ha: Readonly<{
    exposure: WebExposure;
  }>;
  // Hindsight runs independently in OrbStack on the mini. Only its control
  // plane gets a browser hostname; the memory API stays on its existing route.
  hindsight: Readonly<{
    exposure: WebExposure;
  }>;
  // The Synology DSM: a LAN appliance, not a workload
  // of ours at all — it's a box on the LAN — but it gets a tunnel hostname
  // behind Access, and hostnames are owned here. Its origin is HTTPS with a
  // self-signed cert; its tunnel origin carries `noTlsVerify`.
  dsm: Readonly<{
    exposure: WebExposure;
  }>;
  services: Readonly<Record<ControlCenterServiceName, ProductServiceDeclaration>>;
  secretUsages: Readonly<Record<ControlCenterSecretUsageName, ServiceSecretUsage>>;
}>;

export function controlCenterProductManifest(): ControlCenterProductManifest {
  const product = defineProduct("control-center");
  const target = homelabTarget;
  const secretUsages = controlCenterServiceSecretUsages();

  return {
    product,
    target,
    app: {
      exposure: privateWeb(target, { host: "app" }),
    },
    ha: {
      // Single label under the zone, so Universal SSL's one-label wildcard
      // covers it (see webHostname).
      exposure: privateWeb(target, { host: "ha" }),
    },
    hindsight: {
      exposure: privateWeb(target, { host: "hindsight" }),
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
      cloudflared: {
        service: "cloudflared",
        exposure: null,
        secretUsage: secretUsages.cloudflared,
      },
    },
    secretUsages,
  };
}
