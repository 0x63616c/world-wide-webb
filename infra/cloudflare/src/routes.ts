// Tunnel ingress + proxied DNS for control-center, a pure Pulumi-friendly
// declaration.
//
// ADOPT-ONLY (www-j934.2): these mirror the LIVE tunnel ingress + proxied CNAMEs
// (verified 2026-06-11) EXACTLY, so the first `pulumi preview` after `pulumi
// import` is 0 create / 0 delete / 0 replace. We import what is DEPLOYED, warts
// and all: that includes `portainer` (retiring at cutover, www-j934.9) and a
// stray `hooks-test` CNAME. Their removals become explicit, reviewable diffs at
// their scheduled phases (portainer at cutover; hooks + hooks-test at the CI
// rework, www-j934.14/.15), NOT silent drops here.
//
// Ingress and CNAMEs are SEPARATE lists because the live state isn't symmetric:
// every ingress host has a CNAME, but `hooks-test` has a CNAME with NO ingress
// rule (a leftover). Modeling them separately is what makes the import exact.
//
// captive-portal is intentionally absent from BOTH: it is LAN-only, reached over
// the OrbStack LoadBalancer on the mini's en1 (DESIGN §5a), never tunneled.

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
  // comments, hooks/portainer have none); `undefined` = no comment.
  comment?: string;
}

// LIVE tunnel ingress (5 hosts + the implicit catchall 404). Ports match the
// origins cloudflared forwards to. `portainer` + `hooks` are present today and
// retire later as explicit diffs (see header).
const INGRESS: Record<string, string> = {
  dashboard: "http://web:80",
  portainer: "http://portainer:9000",
  // Frozen legacy origin: the live `hooks` ingress still points at the old
  // webhook-receiver service name. Adopt-only must match it byte-for-byte; the
  // record retires as an explicit diff at the CI rework (www-j934.14/.15).
  hooks: "http://bosun-agent:4202",
  storybook: "http://storybook:6006",
  drizzle: "http://drizzle:4983",
};

// LIVE proxied CNAMEs: the 5 ingress hosts PLUS the stray `hooks-test` leftover.
// Each carries its exact live CF comment (varied; legacy evee comments on
// drizzle/hooks-test, none on hooks/portainer) so the import is zero-diff.
// Frozen legacy CF comment values: dashboard/storybook carry an ownership-tagged
// route comment baked into live Cloudflare state. Adopt-only must match them
// byte-for-byte for a zero-diff import; they are intentionally immutable here.
const CNAME_COMMENTS: Record<string, string | undefined> = {
  dashboard: "bosun:control-center tunnel route",
  storybook: "bosun:control-center tunnel route",
  drizzle: "Drizzle Gateway via evee-webhooks tunnel (www-0ub8)",
  "hooks-test": "EVEE-218 webhook test (apex naming, covered by Universal SSL)",
  hooks: undefined,
  portainer: undefined,
};

/** The live tunnel ingress rules for zone `<zone>` (adopt-only import target). */
export function desiredIngressRules(zone: string): DesiredIngressRule[] {
  return Object.entries(INGRESS).map(([sub, service]) => ({
    hostname: `${sub}.${zone}`,
    service,
  }));
}

/** The live proxied CNAMEs for zone `<zone>` (adopt-only import target). */
export function desiredCnames(zone: string): DesiredCname[] {
  return Object.entries(CNAME_COMMENTS).map(([sub, comment]) => ({
    hostname: `${sub}.${zone}`,
    proxied: true,
    target: tunnelCnameTarget,
    comment,
  }));
}
