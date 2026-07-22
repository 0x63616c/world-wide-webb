// Tunnel ingress + proxied DNS for control-center, a pure Pulumi-friendly
// declaration.
//
// The control-center app route is product-derived (productRoutes(), the
// `app.worldwidewebb.co` single-label host from the platform manifest). The
// flattened `app--cc.worldwidewebb.co` cutover host and the `${host}--${dnsCode}`
// scheme were retired in Task 7 Step C; the imported legacy tooling hosts below
// (storybook/drizzle/hooks-test) stay explicit as their own removal tickets.
//
// Ingress and CNAMEs are SEPARATE lists because the live state isn't symmetric:
// every ingress host has a CNAME, but `hooks-test` has a CNAME with NO ingress
// rule (a leftover). Modeling them separately is what makes the import exact.
//
// captive-portal is intentionally absent from BOTH: it is LAN-only, reached over
// the OrbStack LoadBalancer on the mini's en1 (DESIGN §5a), never tunneled.

import { controlCenterProductManifest, type ProductServiceDeclaration } from "@www/platform";

/** The CNAME target every tunnel-routed hostname points at. */
export function tunnelCnameTarget(tunnelId: string): string {
  return `${tunnelId}.cfargotunnel.com`;
}

/** A live tunnel ingress rule: hostname -> in-cluster origin. */
export interface DesiredIngressRule {
  hostname: string;
  // The origin the tunnel forwards to (`http://<service>:<port>`).
  service: string;
}

/** A live proxied CNAME for a tunnel-routed hostname. */
export interface DesiredCname {
  hostname: string;
  proxied: true;
  target: (tunnelId: string) => string;
  // The record's CF `comment`, matching live EXACTLY for a zero-diff import.
  // These vary per record (frozen legacy values below: dashboard/storybook carry
  // a legacy ownership-tagged route comment, drizzle/hooks-test carry legacy evee
  // comments); `undefined` = no comment.
  comment?: string;
}

export type CloudflareExposureSource = Readonly<{
  exposure: ProductServiceDeclaration["exposure"];
  origin: string;
  comment?: string;
}>;

export type CloudflareRoutes = Readonly<{
  ingressRules: readonly DesiredIngressRule[];
  cnames: readonly DesiredCname[];
}>;

// LIVE tunnel ingress (3 hosts + the implicit catchall 404). Ports match the
// origins cloudflared forwards to. The dead `portainer` + `hooks` routes (origins
// removed with bosun) were pruned in www-oa74.
const LEGACY_INGRESS: Record<string, string> = {
  storybook: "http://storybook.control-center.svc.cluster.local:6006",
  drizzle: "http://drizzle.control-center.svc.cluster.local:4983",
};

// LIVE proxied CNAMEs: the 3 ingress hosts PLUS the stray `hooks-test` leftover.
// Each carries its exact live CF comment (varied; legacy evee comments on
// drizzle/hooks-test). Frozen legacy CF comment values: dashboard/storybook carry
// an ownership-tagged route comment baked into live Cloudflare state; they are
// intentionally immutable here. The dead `hooks` + `portainer` CNAMEs were pruned
// in www-oa74.
const LEGACY_CNAME_COMMENTS: Record<string, string | undefined> = {
  storybook: "bosun:control-center tunnel route",
  drizzle: "Drizzle Gateway via evee-webhooks tunnel (www-0ub8)",
  "hooks-test": "EVEE-218 webhook test (apex naming, covered by Universal SSL)",
};

export function cloudflareRoutesForExposures(
  sources: readonly CloudflareExposureSource[],
): CloudflareRoutes {
  const exposed = sources.filter(
    (
      source,
    ): source is CloudflareExposureSource & {
      exposure: Extract<ProductServiceDeclaration["exposure"], { kind: "private-web" }>;
    } => source.exposure?.kind === "private-web",
  );

  return {
    ingressRules: exposed.map((source) => ({
      hostname: source.exposure.hostname,
      service: source.origin,
    })),
    cnames: exposed.map((source) => ({
      hostname: source.exposure.hostname,
      proxied: true as const,
      target: tunnelCnameTarget,
      comment: source.comment,
    })),
  };
}

function productRoutes(): CloudflareRoutes {
  const cc = controlCenterProductManifest();

  const sources: CloudflareExposureSource[] = [
    {
      exposure: cc.app.exposure,
      origin: "http://web.control-center.svc.cluster.local:80",
      comment: "platform:control-center private app route",
    },
  ];

  return cloudflareRoutesForExposures(sources);
}

/** The live tunnel ingress rules for zone `<zone>` (adopt-only import target). */
export function desiredIngressRules(zone: string): DesiredIngressRule[] {
  return [
    ...productRoutes().ingressRules,
    ...Object.entries(LEGACY_INGRESS).map(([sub, service]) => ({
      hostname: `${sub}.${zone}`,
      service,
    })),
  ];
}

/** The live proxied CNAMEs for zone `<zone>` (adopt-only import target). */
export function desiredCnames(zone: string): DesiredCname[] {
  return [
    ...productRoutes().cnames,
    ...Object.entries(LEGACY_CNAME_COMMENTS).map(([sub, comment]) => ({
      hostname: `${sub}.${zone}`,
      proxied: true as const,
      target: tunnelCnameTarget,
      comment,
    })),
  ];
}
