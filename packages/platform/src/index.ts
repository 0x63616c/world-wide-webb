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
