// Pulumi program for the control-center Cloudflare edge state (CC-j934.2).
//
// ADOPT-ONLY this milestone: every resource here mirrors the DEPLOYED Cloudflare
// state (declaring only what is LIVE per CC-cuuw), is `pulumi import`-ed, and is marked
// `protect: true`. The acceptance gate is that the first `pulumi preview` after
// import shows 0 create / 0 delete / 0 replace. NO `pulumi up`/apply this ticket.
//
// Config (all from 1Password via `pulumi config set [--secret]`, NEVER literals):
//   cloudflare apiToken   op://Homelab/Cloudflare API/credential   (account-owned;
//                          verify via GET /accounts/{account_id}/tokens/verify,
//                          NOT /user/tokens/verify)
//   accountId / zoneId / tunnelId / zoneName   op://Homelab/Cloudflare API/*
//   allowedEmail                               the OTP allow email (PII; SECRET config)
//
// SERVICE-TOKEN SECRETS ARE NEVER USED HERE: the deployed apps use email-OTP
// includes, so no service token is referenced at all. (The dashboard
// service-token app + Block floor are deferred to CC-jhly.) If a future resource
// needs a token, it references the token by id, never the client secret.

import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";
import { desiredAccessApps } from "./src/access.ts";
import { desiredCnames, desiredIngressRules } from "./src/routes.ts";

const cfg = new pulumi.Config();
// zoneName is the public domain (plaintext). The account/zone/tunnel ids + the
// allow email are SECRET config (encrypted in Pulumi.prod.yaml): this is a PUBLIC
// repo and those identifiers are deliberately kept out of it (same rule as the
// deploy.config.ts op-secret channel). All sourced from op at `pulumi config set`.
const zoneName = cfg.require("zoneName");
const accountId = cfg.requireSecret("accountId");
const zoneId = cfg.requireSecret("zoneId");
const tunnelId = cfg.requireSecret("tunnelId");
const allowedEmail = cfg.requireSecret("allowedEmail");

// Provider authenticated by the account-owned API token (secret config).
//
// version is PINNED to match the @pulumi/cloudflare SDK major (v5). Pulumi
// otherwise auto-downloads the "latest" plugin (v6, a major CF-provider rewrite
// with a different zero_trust_access_application schema); a v6 plugin writing
// import state that the v5 SDK then diffs throws "State version 500 > schema
// version 0". Pinning keeps import + diff + SDK on one schema, and makes CI
// reproducible (CC-j934.2). Bumping to v6 is a separate, deliberate upgrade.
const provider = new cloudflare.Provider(
  "cf",
  { apiToken: cfg.requireSecret("apiToken") },
  { version: "5.49.1" },
);
const opts: pulumi.CustomResourceOptions = { provider, protect: true };

// Stable Pulumi resource name from a hostname ("storybook.worldwidewebb.co" ->
// "storybook"). Keeps logical names short + readable in state.
const sub = (host: string) => host.split(".")[0];

// --- Access apps + their allow/email policies (adopt-only) ---
// Field set mirrors what `pulumi import` recorded as the v5 provider's meaningful
// inputs (accountId, name, type, tags, httpOnlyCookieAttribute) so the import is
// zero-diff. The provider DERIVES selfHostedDomains from `name` and treats
// sessionDuration / appLauncherVisible / autoRedirectToIdentity as managed
// defaults, so declaring them here would show a spurious update - left off.
for (const app of desiredAccessApps(zoneName)) {
  const name = sub(app.domain);
  const cfApp = new cloudflare.ZeroTrustAccessApplication(
    name,
    {
      accountId,
      name: app.domain,
      type: app.type,
      httpOnlyCookieAttribute: true,
      tags: [app.tag],
    },
    opts,
  );

  // The single allow policy: email-OTP, the email from SECRET config (never a
  // repo literal). precedence 1 matches the live policy.
  new cloudflare.ZeroTrustAccessPolicy(
    `${name}-policy`,
    {
      accountId,
      // Live policies are app-scoped; the provider models the link via applicationId.
      applicationId: cfApp.id,
      name: app.domain,
      decision: app.decision,
      precedence: 1,
      includes: [{ emails: [allowedEmail] }],
    },
    opts,
  );
}

// --- Tunnel ingress config (adopt-only) ---
// A single ZeroTrustTunnelCloudflaredConfig holds all ingress rules in order,
// ending in the catchall http_status:404 (matches live exactly).
new cloudflare.ZeroTrustTunnelCloudflaredConfig(
  "tunnel-config",
  {
    accountId,
    tunnelId,
    config: {
      ingressRules: [
        ...desiredIngressRules(zoneName).map((r) => ({ hostname: r.hostname, service: r.service })),
        { service: "http_status:404" },
      ],
    },
  },
  opts,
);

// --- Proxied DNS CNAMEs -> the tunnel (adopt-only) ---
// Field set mirrors the imported records EXACTLY so the import is zero-diff:
// `name` is the SUBDOMAIN only ("storybook", not the FQDN, the v5 provider
// stores the short name and changing it forces a destructive replace), `comment`
// is each record's exact live value (varies; undefined = no comment), ttl 1 =
// "automatic", proxied. `content` is the tunnel target (tunnelId from config =
// the live tunnel UUID, so the target matches live).
//
// !!! KNOWN v5 IMPORT ARTIFACT, DO NOT "FIX" BY APPLYING !!!
// `pulumi preview` shows each Record with a benign `~ update [+content,
// +allowOverwrite]`. This is NOT drift: @pulumi/cloudflare 5.49.1 does not
// round-trip a proxied CNAME's `content` (or the input-only `allowOverwrite`) on
// `pulumi import`, so import recorded content=null while the program supplies the
// VALUE-IDENTICAL live target (verified: live `dig`/API content ==
// <tunnelId>.cfargotunnel.com). The pending update is a no-op; it self-heals on
// the first LEGITIMATE apply (Phase-4 cutover). Do NOT run `pulumi up` here just
// to silence the preview - adopt-only this ticket (CC-j934.2; ruling B).
for (const c of desiredCnames(zoneName)) {
  new cloudflare.Record(
    sub(c.hostname),
    {
      zoneId,
      name: sub(c.hostname),
      type: "CNAME",
      // tunnelId is a secret Output, so build the target via interpolate.
      content: pulumi.interpolate`${tunnelId}.cfargotunnel.com`,
      proxied: c.proxied,
      ttl: 1,
      ...(c.comment ? { comment: c.comment } : {}),
    },
    opts,
  );
}

export const summary = {
  zoneName,
  accessApps: desiredAccessApps(zoneName).map((a) => a.domain),
  ingressHosts: desiredIngressRules(zoneName).map((r) => r.hostname),
  cnames: desiredCnames(zoneName).map((c) => c.hostname),
};
