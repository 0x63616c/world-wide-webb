// Tunnel ingress + proxied DNS for control-center, a pure Pulumi-friendly
// declaration.
//
// The control-center app route is product-derived (productRoutes(), the
// `app.worldwidewebb.co` single-label host from the platform manifest). The
// flattened `app--cc.worldwidewebb.co` cutover host and the `${host}--${dnsCode}`
// scheme were retired in Task 7 Step C.
//
// Ingress and CNAMEs are SEPARATE lists because the live state was not always
// symmetric (a retired record was once a CNAME with no ingress rule). They are
// symmetric today, but keeping the lists separate leaves room for the next
// asymmetric host without reshaping the model.

import { controlCenterProductManifest, type ProductServiceDeclaration } from "@www/platform";

/** The CNAME target every tunnel-routed hostname points at. */
export function tunnelCnameTarget(tunnelId: string): string {
  return `${tunnelId}.cfargotunnel.com`;
}

/**
 * Per-origin connection options for an ingress rule.
 *
 * Mini origins use HTTP on the connector's host network. Synology DSM uses
 * HTTPS with a self-signed certificate, so cloudflared needs an explicit
 * per-origin exception to reach it.
 *
 * @public part of the ingress declaration surface — named so a rule's options
 * can be typed at the call site even though every current consumer reaches it
 * structurally through DesiredIngressRule.
 */
export interface DesiredOriginRequest {
  /** Skip origin certificate verification. Self-signed LAN appliances only. */
  noTlsVerify?: boolean;
  /** SNI to present to the origin, when its cert names something else. */
  originServerName?: string;
}

/** A live tunnel ingress rule: hostname -> mini or LAN appliance origin. */
export interface DesiredIngressRule {
  hostname: string;
  // Optional RE2 path regex. Rules sharing a hostname must put the narrower
  // path first; the first matching cloudflared ingress rule wins.
  path?: string;
  // The origin the tunnel forwards to (`http://<service>:<port>`, or an
  // `https://<ip>:<port>` LAN appliance paired with `originRequest` below).
  service: string;
  originRequest?: DesiredOriginRequest;
}

/** A live proxied CNAME for a tunnel-routed hostname. */
export interface DesiredCname {
  hostname: string;
  proxied: true;
  target: (tunnelId: string) => string;
  // The record's CF `comment`, matching live EXACTLY. `undefined` = no comment.
  comment?: string;
}

export type CloudflareExposureSource = Readonly<{
  exposure: ProductServiceDeclaration["exposure"];
  origin: string;
  originRequest?: DesiredOriginRequest;
  comment?: string;
}>;

export type CloudflareRoutes = Readonly<{
  ingressRules: readonly DesiredIngressRule[];
  cnames: readonly DesiredCname[];
}>;

export function cloudflareRoutesForExposures(
  sources: readonly CloudflareExposureSource[],
): CloudflareRoutes {
  // Both web kinds get a tunnel route and a proxied CNAME; they differ only in
  // whether an Access app is declared for them (see access.ts, which filters on
  // "private-web" alone). Routing and gating are deliberately separate
  // decisions — conflating them is how a public host silently loses its gate.
  const exposed = sources.filter(
    (
      source,
    ): source is CloudflareExposureSource & {
      exposure: Extract<
        ProductServiceDeclaration["exposure"],
        { kind: "private-web" } | { kind: "public-web" }
      >;
    } => source.exposure?.kind === "private-web" || source.exposure?.kind === "public-web",
  );

  return {
    ingressRules: exposed.map((source) => ({
      hostname: source.exposure.hostname,
      service: source.origin,
      ...(source.originRequest ? { originRequest: source.originRequest } : {}),
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
      origin: "http://127.0.0.1:4201",
      comment: "platform:control-center private app route",
    },
    {
      exposure: cc.dsm.exposure,
      // Synology DSM. .218 — NOT .219, which is a long-running
      // mis-transcription in this repo's history.
      origin: "https://192.168.0.218:5001",
      originRequest: { noTlsVerify: true },
      comment: "platform:synology dsm route (#292)",
    },
    {
      exposure: cc.ha.exposure,
      origin: "http://192.168.0.130:8123",
      comment: "platform:home assistant web ui route (#75)",
    },
  ];

  const routes = cloudflareRoutesForExposures(sources);
  return {
    ...routes,
    // Narrow paths precede the app's catch-all. Access still gates this same
    // hostname; POST additionally checks the existing automation bearer.
    // Keep the release path ordering stable; www serves both API and web.
    ingressRules: [
      {
        hostname: cc.app.exposure.hostname,
        path: "^/api/releases/latest$",
        service: "http://127.0.0.1:4201",
      },
      ...routes.ingressRules,
    ],
  };
}

/** Production origins as reached by the mini's host-networked connector. */
export function desiredIngressRules(): DesiredIngressRule[] {
  return [...productRoutes().ingressRules];
}

/** Proxied DNS for the retained application and appliance hostnames. */
export function desiredCnames(): DesiredCname[] {
  return [...productRoutes().cnames];
}
