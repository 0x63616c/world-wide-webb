# Hostname retirement matrix

All `worldwidewebb.co` hostnames, their current status, preconditions for retirement,
and rollback steps. Live CF tunnel state is declared in `infra/cloudflare/src/routes.ts`.
Rewritten 2026-07-22 after the single-product merge (ADR-0006) — the previous version of
this doc predated it and described `app--cc` as permanent and `app--cp` as planned; both
are obsolete.

---

## Canonical

| Hostname | Surface | Exposure | Status |
|---|---|---|---|
| `app.worldwidewebb.co` | Control Center panel web | private (CF Access) | **live, canonical** (ADR-0006) |

---

## Already retired

| Hostname | Status |
|---|---|
| `app--cc.worldwidewebb.co` | **Retired (Task 7 Step C, 2026-07-22).** The wall panel's previous flattened home, superseded by the single-label `app.worldwidewebb.co`. The `${host}--${dnsCode}` flattening helper + `dnsCode` were deleted from `packages/platform`; the CF DNS/route/Access entries were removed from `infra/cloudflare/src` and `pulumi up` applied. `routes.test.ts` / `access.test.ts` assert absence. |
| `app--cp.worldwidewebb.co` | **Retired (Task 7 Step C, 2026-07-22).** Abandoned by ADR-0006 (captive-portal product dissolved) — never went live. Residue pruned: cert SAN in `infra/src/certmanager.ts`, the `applyAppCp` A-record + guest `portalHostname` in `infra/unifi/src/unifi.ts`, platform `dnsCode` `"cp"`. The UniFi stack's `pulumi up` is deferred (separate project). |
| `dashboard.worldwidewebb.co` | Retired (pre-Track-0); `routes.test.ts` asserts absence. |
| `portainer.worldwidewebb.co` | Removed from CF tunnel. |
| `hooks.worldwidewebb.co` | Removed from CF tunnel. |

---

## LAN-only (no CF tunnel, cert-manager TLS)

| Hostname | Purpose | Status |
|---|---|---|
| `captive-portal.worldwidewebb.co` | Guest Wi-Fi portal TLS cert name | **Keep.** The cert (secret `captive-portal-tls`, control-center namespace) serves the portal-only guest listener on the control-center api. Deliberate legacy name, not a leftover. |

---

## Dev tooling (CF tunnel, at Calum's discretion)

| Hostname | Backend | Status |
|---|---|---|
| `storybook.worldwidewebb.co` | `storybook:6006` | Active; retire whenever decided. |
| `drizzle.worldwidewebb.co` | `drizzle:4983` | Active; retire whenever decided. |
| `hooks-test.worldwidewebb.co` | none (dangling CNAME) | Safe to remove now. |
