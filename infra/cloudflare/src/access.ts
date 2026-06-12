// Cloudflare Access surface for control-center (www-cuuw), a pure
// Pulumi-friendly declaration.
//
// ADOPT-ONLY (www-j934.2): this declares EXACTLY the apps that are DEPLOYED in
// Cloudflare today (verified live 2026-06-11; matches bd memory
// access-gate-design-cc-cuuw), so the first `pulumi preview` after `pulumi
// import` shows 0 create / 0 delete / 0 replace. The full www-cuuw END-STATE plan
// is a 5-app default-deny matrix; only a SUBSET is deployed, so we adopt that
// subset, not the plan.
//
// Deployed today: storybook + drizzle, each a self_hosted app with an `allow`
// policy whose include is a single email (OTP login). The wildcard `*.<zone>`
// Block floor and the dashboard service-token app are DELIBERATELY NOT deployed
// yet (gated on the kiosk iOS TestFlight build, www-cuuw plan §6); creating them
// is a separate, deliberate `pulumi up` tracked in www-jhly, NOT this ticket.
//
// The allow email is PII: it is NOT a literal here (no-personal-email guard). It
// rides the `allowedEmail` Pulumi SECRET config (sourced from 1Password), so the
// repo carries only the config-key reference; the value lives in Pulumi Cloud
// state, never a repo file.

// CF token verification NOTE (www-j934.2): the admin token
// (op://Homelab/Cloudflare API/credential) is ACCOUNT-OWNED, so it verifies via
// GET /accounts/{account_id}/tokens/verify, NOT /user/tokens/verify (the user
// endpoint fails account-owned tokens by design). It already carries the account
// + zone scopes incl. DNS:Edit. Don't re-trip the /user verify dead end.

/** A desired Access application: one gated domain + its single allow policy. */
export interface DesiredAccessApp {
  // The single hostname this app gates.
  domain: string;
  // CF policy decision. The deployed apps are all `allow` (email OTP).
  decision: "allow";
  // The app type as CF models it (the live apps are self_hosted).
  type: "self_hosted";
  // The allow principal: an email resolved at apply time from the `allowedEmail`
  // Pulumi secret config (never a literal in the repo).
  emailFromConfig: "allowedEmail";
  // Ownership tag the live apps already carry, so importing them is a zero-diff.
  // The literal value is a frozen legacy string baked into live Cloudflare state;
  // renaming it would be a destructive replace, so it is intentionally immutable.
  tag: string;
}

// Frozen legacy ownership tag matching the live Cloudflare app metadata exactly
// (see DesiredAccessApp.tag). Immutable: changing it forces a destructive replace.
const OWNERSHIP_TAG = "bosun:control-center";

/**
 * The DEPLOYED Access apps for zone `<zone>` (storybook + drizzle, email-OTP).
 * This is the adopt-only import target; it intentionally OMITS the not-yet-built
 * Block floor + dashboard service-token app (tracked separately in www-jhly).
 */
export function desiredAccessApps(zone: string): DesiredAccessApp[] {
  return ["storybook", "drizzle"].map((sub) => ({
    domain: `${sub}.${zone}`,
    decision: "allow",
    type: "self_hosted",
    emailFromConfig: "allowedEmail",
    tag: OWNERSHIP_TAG,
  }));
}
