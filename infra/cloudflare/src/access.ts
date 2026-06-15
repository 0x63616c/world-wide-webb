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
} from "@repo/platform";

type AccessConfigKey = "allowedEmail" | "ciClientId" | "kioskClientId";

export type AccessInclude =
  | Readonly<{ kind: "email-config"; configKey: "allowedEmail" }>
  | Readonly<{ kind: "service-token-config"; configKey: Exclude<AccessConfigKey, "allowedEmail"> }>
  | Readonly<{ kind: "everyone" }>;

type DesiredAccessPolicy = Readonly<{
  name: string;
  decision: "allow" | "deny";
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
  policy: "email-otp" | "kiosk-service-token";
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
  configKey: "ciClientId" | "kioskClientId",
): DesiredAccessPolicy {
  return {
    name,
    decision: "allow",
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
      accessApp(source.exposure.hostname, [
        source.policy === "kiosk-service-token"
          ? serviceTokenPolicy("kiosk-service-token", "kioskClientId")
          : emailOtpPolicy(),
      ]),
    );
}

/**
 * The desired Access apps for zone `<zone>`.
 *
 * `includeGate` (default false) toggles the zone-wide access gate (www-cuuw):
 * a `*.<zone>` default-DENY floor plus tooling locks (storybook/drizzle/hooks).
 * It is OFF by default because the floor's wildcard also catches any currently
 * PUBLIC host that lacks an explicit allow above it, e.g. the live `dashboard`
 * wall panel (until it cuts over to `app--cc`) and public `app--tye`. Enabling
 * it before those have an explicit bypass would lock them out (www-b6ad). The
 * per-product private-route apps (CC/AMP) are ALWAYS returned: they gate the
 * product hosts themselves and are safe to apply independent of the floor.
 */
export function desiredAccessApps(zone: string, includeGate = false): DesiredAccessApp[] {
  const ccManifest = controlCenterProductManifest();
  const ampManifest = ampProductManifest();

  // Private-web products: AMP uses email-OTP (human web access); the CC
  // dashboard uses a kiosk service-token (iPad wall panel, not human login).
  const productApps = accessAppsForPrivateWeb([
    { exposure: ccManifest.app.exposure, policy: "kiosk-service-token" },
    { exposure: ampManifest.app.exposure, policy: "email-otp" },
  ]);

  if (!includeGate) return productApps;

  return [
    wildcardBlockFloor(zone),
    ...productApps,
    accessApp(`storybook.${zone}`, [emailOtpPolicy()]),
    accessApp(`drizzle.${zone}`, [emailOtpPolicy()]),
    accessApp(`hooks.${zone}`, [serviceTokenPolicy("ci-service-token", "ciClientId")]),
  ];
}
