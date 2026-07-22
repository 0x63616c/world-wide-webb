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

## Pending retirement

### `app--cc.worldwidewebb.co`

- **Current:** Active alongside `app`. The wall panel's previous home; the iOS shell was
  repointed to `app.worldwidewebb.co` (TestFlight build shipped 2026-07-21).
- **Retire when:**
  - [ ] Calum confirms the physical panel renders on `app.worldwidewebb.co` from the new
    TestFlight build (Track 0 Task 7 Step C gate)
- **How to retire:** Remove the `app--cc` DNS/route/Access entries from
  `infra/cloudflare/src`, delete the `${host}--${dnsCode}` flattening helper + `dnsCode`
  from `packages/platform`, update `routes.test.ts`, `pulumi up` in `infra/cloudflare`.
  Also update `scripts/verify-wall-panel.mjs` (default still `app--cc`).
- **Rollback:** Re-add the entries, `pulumi up`.

---

## Abandoned (never went live)

| Hostname | Fate |
|---|---|
| `app--cp.worldwidewebb.co` | Abandoned by ADR-0006 (captive-portal product dissolved). Residue to prune with Step C: cert SAN in `infra/src/certmanager.ts`, `applyAppCp` gate in `infra/unifi/src/unifi.ts`, platform `"cp"` references. |

---

## Already retired

| Hostname | Status |
|---|---|
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
