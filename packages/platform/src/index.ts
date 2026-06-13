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
