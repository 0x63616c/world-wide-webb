# Hostname retirement matrix (www-jtp0.3.8)

All `worldwidewebb.co` hostnames, their current status, preconditions for retirement,
and rollback steps. Live CF tunnel state is declared in `infra/cloudflare/src/routes.ts`.

---

## Product hostnames (canonical, keep forever)

| Hostname | Product | Exposure | Status |
|---|---|---|---|
| `app--cc.worldwidewebb.co` | Control Center | private (CF Access kiosk token) | **live, canonical** |
| `app--cp.worldwidewebb.co` | Captive Portal | LAN-only (no CF tunnel) | **target, not yet DNS-live** — pending www-jtp0.5.8/5.9 |

---

## Legacy hostnames (CF tunnel, currently active)

### `dashboard.worldwidewebb.co`

- **Current:** Active. `LEGACY_INGRESS` in `routes.ts` → `http://web:80`. Compatibility alias for CC during iOS migration.
- **Retire when:**
  - [ ] www-jtp0.7.7 prod DB cutover complete
  - [ ] www-jtp0.7.8 TestFlight on `app--cc` verified on iPad (done — build 60 confirmed)
  - [ ] www-jtp0.7.10 wall-panel verified at 1366×1024 on `app--cc`
  - [ ] Calum explicit approval
- **How to retire:** Remove `dashboard` from `LEGACY_INGRESS` + `LEGACY_CNAME_COMMENTS`, drop `legacyHostname` from CC manifest, update `routes.test.ts` to assert absence, `pulumi up`.
- **Rollback:** Re-add entries to `LEGACY_INGRESS`/`LEGACY_CNAME_COMMENTS` + manifest, `pulumi up`.

### `storybook.worldwidewebb.co`

- **Current:** Active. `LEGACY_INGRESS` → `http://storybook:6006`. Dev tooling surface; no product dependency.
- **Retire when:** Decided by Calum. No blockers beyond decision.
- **How to retire:** Remove from `LEGACY_INGRESS` + `LEGACY_CNAME_COMMENTS`, `pulumi up`.
- **Rollback:** Re-add, `pulumi up`.

### `drizzle.worldwidewebb.co`

- **Current:** Active. `LEGACY_INGRESS` → `http://drizzle:4983`. Dev tooling surface.
- **Retire when:** Decided by Calum.
- **Rollback:** Same pattern as storybook.

### `hooks-test.worldwidewebb.co`

- **Current:** CNAME only (no ingress rule). Leftover from EVEE-218. No live service behind it.
- **Retire when:** Can retire now — no service behind it. Just a dangling CNAME.
- **How to retire:** Remove from `LEGACY_CNAME_COMMENTS`, `pulumi up`.
- **Rollback:** Re-add, `pulumi up`.

---

## Already retired

| Hostname | Ticket | Status |
|---|---|---|
| `portainer.worldwidewebb.co` | www-oa74 | Removed from CF tunnel. `curl` returns 404. |
| `hooks.worldwidewebb.co` | www-oa74 | Removed from CF tunnel. `curl` returns 404. |

---

## LAN-only (no CF tunnel, cert-manager TLS only)

| Hostname | Purpose | Status |
|---|---|---|
| `captive-portal.worldwidewebb.co` | Legacy captive portal LAN surface | Active on cert, LAN-served. Retire after `app--cp` DNS goes live (www-jtp0.5.9). |
| `app--cp.worldwidewebb.co` | Captive Portal product LAN surface | On cert (www-jtp0.5.8). DNS record pending (www-jtp0.5.9 flag flip). |

---

## Retirement order

1. `hooks-test` — no blocker, safe now
2. `captive-portal` LAN alias — after www-jtp0.5.9 DNS live + www-jtp0.5.10 guest cutover verified
3. `dashboard` — after www-jtp0.7.7 + www-jtp0.7.10 + Calum approval
4. `storybook` / `drizzle` — at Calum's discretion
