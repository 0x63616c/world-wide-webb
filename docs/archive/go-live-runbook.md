# world-wide-webb Go-Live Runbook

The autonomous build is complete: every product (control-center, captive-portal,
text-your-ex, amp) is built, tested, and on `main`; **Text Your Ex is already
deployed and running in prod** (tye-api Ready, CNPG up). What remains is a short
sequence of **human-only** actions, billing toggles, naming decisions, and two
irreversible prod-data operations, plus on-glass physical checks. Do them in this
order; each step lists the exact commands and the verification.

This runbook is the single source of truth for finishing the migration. The
per-area runbooks it references (`docs/k3s-migration/cc-cutover-runbook.md`,
`docs/amp/cutover-verification.md`, `docs/captive-portal/runbook.md`,
`docs/m9-*.md`) hold the detail.

---

## 0. Prereq: 1Password SSH agent

If `git push` / commit signing fail with "agent refused operation", unlock the
1Password desktop app (the SSH key that authenticates GitHub + signs commits is
served by it). Everything below assumes pushes work.

## 1. TLS: free, no billing action (www-kbiy, DONE in code)

Product hosts are **flattened to a single label**: `app--tye`, `app--cc`,
`app--amp`, `app--cp` (double hyphen). A single-label host IS covered by the free
Cloudflare Universal SSL `*.worldwidewebb.co`, so there is **no ACM, no paid cert,
no billing step**. The old dotted 2-label form (`app` dot `tye` dot the zone) was
what required paid ACM; flattening to one label removes that need entirely.

This lands automatically on the next `pulumi up` of the cloudflare stack (the
`deploy` job runs it on push to `main`). To verify after deploy:

```
curl -s -o /dev/null -w "%{http_code} ssl_verify=%{ssl_verify_result}\n" https://app--tye.worldwidewebb.co
```
Expect `ssl_verify=0` (handshake OK) and a real status (200 public; 302/403 for
the Access-gated `app--cc`/`app--amp`).

## 2. Text Your Ex, finish acceptance (mostly done)

TYE is live at `https://app--tye.worldwidewebb.co` (API at `https://api--tye.worldwidewebb.co`):
- Smoke `https://app--tye.worldwidewebb.co` in a browser (the same flow verified
  locally: sign in → jar → log a slip → confirm DB write).
- iOS TestFlight (6.9/6.10): the `tye-ios-release.yml` gate is removed and the
  workflow is active; pushes touching the iOS shell ship a bundled TestFlight build.

## 3. AMP, verify prod cutover (8.7)

AMP is deployed (stateless). After step 1, run the checklist in
`docs/amp/cutover-verification.md` (pulumi preview gate, kubectl/pod/service
checks, unauthenticated-deny / authenticated-allow through Access).

## 4. Captive portal → app.cp (M3.6 / M5.7-5.10)

LAN-only, NOT Cloudflare. Sequence (detail in `docs/captive-portal/runbook.md`):
1. `cd infra/unifi && export UNIFI_API_KEY=$(op read "op://Homelab/UniFi/local_api_key")`
2. `pulumi config set ccunifi:applyAppCp true --stack prod`
3. `pulumi preview --stack prod` , **review for zero unintended drift** (adopt-only).
4. `pulumi up --stack prod` (adds app.cp split-DNS A record + explicit guest_access).
5. Hotspot Portal console: add the app.cp walled-garden allowance (no provider
   resource for `rest/portalconf`, manual).
6. Cut portal runtime to the product DB (5.7) using the migration tooling
   (`products/captive-portal/scripts/portal-{export,import,validate}.sh`, gated
   behind `PORTAL_*_PROD_APPROVED=1`).
7. **Physical:** join `www-guest` on a phone, confirm the portal loads at
   `app--cp.worldwidewebb.co` with valid TLS (cert-manager DNS-01).

## 5. Control Center → app.cc + P0 data migration (M7)

The risky one. Tooling is built and tested:
- Rehearse restore (7.6): `scripts/cc-cutover-semantic-checks.sql` on a restored copy.
- Preflight gate (7.7): `scripts/cc-cutover-preflight.sh` refuses until rehearsal
  report + snapshots + recorded counts + rollback target + approval all present.
- **P0 data cutover (7.7):** move prod data to the product CNPG per
  `docs/k3s-migration/cc-cutover-runbook.md`. Irreversible, take the snapshots.
- Post-cutover smoke (7.9): `scripts/cc-post-cutover-smoke.sh`.
- iOS kiosk already defaults to `app.cc` (shipped); install the TestFlight build.
- **Physical (7.10):** `scripts/verify-wall-panel.mjs` + eyes on the iPad at
  true 1366×1024 on the private route.
- Retire legacy `dashboard` route only after the panel is verified
  (`docs/k3s-migration/cc-legacy-route-retirement.md`).

## 6. M9, rename + identity (decisions first)

Blocked on naming **decisions** (`docs/m9-*.md` hold the migration/cutover/cleanup
detail):
- 9.3: rename the GitHub repo? (in-code refs are ready once you decide.)
- 9.4: `@repo/*` / `@cc/*` / `@tye/*` / `@product/*` → what final scope convention?
- 9.5: GHCR image names → world-wide-webb naming.
- 9.6: Pulumi config namespace renamed `ccinfra:` → `wwwinfra:` (done). Pulumi project name rename (control-center → world-wide-webb) requires `pulumi stack rename` in Pulumi Cloud + Calum approval.
- 9.8 / 9.9: prod cutover on the renamed identity, then remove old aliases.

## Done-state checklist

- [x] Hosts flattened (`app--tye`/`app--cc`/`app--amp`), free Universal SSL serves valid TLS (www-kbiy, no ACM)
- [ ] TYE acceptance smoked in browser
- [ ] AMP cutover verified
- [ ] app.cp portal live on guest WiFi (physical)
- [ ] CC prod data migrated to product CNPG, panel verified on app.cc (physical)
- [ ] M9 naming decided + applied, old identity retired
