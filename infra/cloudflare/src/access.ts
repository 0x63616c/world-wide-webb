// Cloudflare Access surface for control-center (www-cuuw), a pure
// Pulumi-friendly declaration. Private product hosts must be born locked, while
// legacy hosts remain explicit until their cutover tickets retire them.

// CF token verification NOTE (www-j934.2): the admin token
// (op://Homelab/Cloudflare API/credential) is ACCOUNT-OWNED, so it verifies via
// GET /accounts/{account_id}/tokens/verify, NOT /user/tokens/verify (the user
// endpoint fails account-owned tokens by design). It already carries the account
// + zone scopes incl. DNS:Edit. Don't re-trip the /user verify dead end.

import {
  ampProductManifest,
  controlCenterProductManifest,
  type ProductServiceDeclaration,
} from "@www/platform";

// kioskTokenId: the CF service token *id* (UUID) for the kiosk token — NOT
// the client_id (.access suffix). Access policies reference token_id; the
// client_id is only sent in CF-Access-Client-Id headers by the iOS kiosk app.
type AccessConfigKey = "allowedEmail" | "ciClientId" | "kioskTokenId";

export type AccessInclude =
  | Readonly<{ kind: "email-config"; configKey: "allowedEmail" }>
  | Readonly<{ kind: "service-token-config"; configKey: Exclude<AccessConfigKey, "allowedEmail"> }>
  | Readonly<{ kind: "everyone" }>;

type DesiredAccessPolicy = Readonly<{
  name: string;
  // "non_identity" is CF's "Service Auth" action: it validates the service-token
  // headers on the request directly and short-circuits with a CF_Authorization
  // cookie. "allow" is identity-based, so a service token presented to an "allow"
  // policy is recognized (service_token_status:true) but NOT authorized
  // (auth_status:NONE) — CF redirects to the IdP login. Headless callers
  // (iPad kiosk, CI) MUST use non_identity. (www-azu2 root-cause: CC-d15 gate.)
  decision: "allow" | "deny" | "non_identity";
  precedence: number;
  include: AccessInclude;
}>;

/** A desired Access application: one gated domain plus its explicit policies. */
export interface DesiredAccessApp {
  // The single hostname this app gates.
  domain: string;
  // The app type as CF models it (the live apps are self_hosted).
  type: "self_hosted";
  policies: readonly DesiredAccessPolicy[];
  // Ownership tag the live apps already carry, so importing them is a zero-diff.
  // The literal value is a frozen legacy string baked into live Cloudflare state;
  // renaming it would be a destructive replace, so it is intentionally immutable.
  tag: string;
}

// Frozen legacy ownership tag matching the live Cloudflare app metadata exactly
// (see DesiredAccessApp.tag). Immutable: changing it forces a destructive replace.
const OWNERSHIP_TAG = "bosun:control-center";

export type PrivateWebAccessSource = Readonly<{
  exposure: ProductServiceDeclaration["exposure"];
  policies: readonly ("email-otp" | "kiosk-service-token")[];
}>;

function accessApp(domain: string, policies: readonly DesiredAccessPolicy[]): DesiredAccessApp {
  return {
    domain,
    type: "self_hosted",
    policies,
    tag: OWNERSHIP_TAG,
  };
}

function emailOtpPolicy(): DesiredAccessPolicy {
  return {
    name: "email-otp",
    decision: "allow",
    precedence: 1,
    include: { kind: "email-config", configKey: "allowedEmail" },
  };
}

function serviceTokenPolicy(
  name: "ci-service-token" | "kiosk-service-token",
  configKey: "ciClientId" | "kioskTokenId",
): DesiredAccessPolicy {
  return {
    name,
    // Service Auth (non_identity), NOT allow — see DesiredAccessPolicy.decision.
    decision: "non_identity",
    precedence: 1,
    include: { kind: "service-token-config", configKey },
  };
}

function wildcardBlockFloor(zone: string): DesiredAccessApp {
  return accessApp(`*.${zone}`, [
    {
      name: "default-deny",
      decision: "deny",
      precedence: 99,
      include: { kind: "everyone" },
    },
  ]);
}

export function accessAppsForPrivateWeb(
  sources: readonly PrivateWebAccessSource[],
): DesiredAccessApp[] {
  return sources
    .filter(
      (
        source,
      ): source is PrivateWebAccessSource & {
        exposure: Extract<ProductServiceDeclaration["exposure"], { kind: "private-web" }>;
      } => source.exposure?.kind === "private-web",
    )
    .map((source) =>
      accessApp(
        source.exposure.hostname,
        source.policies.map((p, i) => {
          const policy =
            p === "kiosk-service-token"
              ? serviceTokenPolicy("kiosk-service-token", "kioskTokenId")
              : emailOtpPolicy();
          return { ...policy, precedence: i + 1 };
        }),
      ),
    );
}

/**
 * The desired Access apps for zone `<zone>`.
 *
 * `includeGate` (default false) toggles ONLY the NOT-YET-LIVE additions of the
 * zone-wide access gate (www-cuuw): the `*.<zone>` default-DENY floor and the
 * `hooks` CI lock. It is OFF by default because the floor's wildcard also catches
 * any currently PUBLIC host that lacks an explicit allow above it, e.g. the live
 * `dashboard` wall panel (until it cuts over to `app--cc`) and public `app--tye`.
 * Enabling it before those have an explicit bypass would lock them out (www-b6ad).
 *
 * Always returned (safe to apply independent of the floor): the per-product
 * CC/AMP private-route apps (they gate the product hosts themselves), and the
 * already-live `storybook`/`drizzle` email-OTP apps (imported + `protect: true`;
 * omitting them would attempt a blocked delete of live protection).
 */
export function desiredAccessApps(zone: string, includeGate = false): DesiredAccessApp[] {
  const ccManifest = controlCenterProductManifest();
  const ampManifest = ampProductManifest();

  const baseApps: DesiredAccessApp[] = [
    // Private-web products: AMP uses email-OTP (human web access); the CC
    // dashboard uses a kiosk service-token (iPad wall panel, not human login).
    ...accessAppsForPrivateWeb([
      { exposure: ccManifest.app.exposure, policies: ["kiosk-service-token", "email-otp"] },
      { exposure: ampManifest.app.exposure, policies: ["email-otp"] },
    ]),
    // Already-live tooling protections (kept regardless of the gate flag).
    accessApp(`storybook.${zone}`, [emailOtpPolicy()]),
    accessApp(`drizzle.${zone}`, [emailOtpPolicy()]),
  ];

  if (!includeGate) return baseApps;

  return [
    wildcardBlockFloor(zone),
    ...baseApps,
    accessApp(`hooks.${zone}`, [serviceTokenPolicy("ci-service-token", "ciClientId")]),
  ];
}
