# GOAL: Flatten product hostnames (`app.X` → `app--X`), delete ACM, take the route chain live for free

**Ticket:** `www-kbiy` (commit scope `type(networking/www-kbiy)`). Decision recorded 2026-06-15.

## Why
Free Cloudflare Universal SSL covers `*.worldwidewebb.co`, a wildcard matches **exactly one** label, so the nested 2-label hosts `app.cc.worldwidewebb.co` / `app.tye…` / `app.amp…` get no cert and fail the TLS handshake (`sslv3 alert handshake failure`). Rather than pay ~$10/mo for ACM, **flatten to a single label** `app--cc.worldwidewebb.co` (double-dash, Calum's choice). Universal SSL covers it free; CF proxy + Access + the cloudflared tunnel stay intact.

## End state (all must be transcript-provable)

### 1. Hostname template flattened
- `packages/platform/src/index.ts:202` returns `` `${host}--${product.dnsCode}.${target.domain}` `` (the `.` between host and dnsCode becomes `--`). The bare-host template (line ~206, `${dnsCode}.${domain}`) is **unchanged**, single-label already.
- Resulting hosts: `app--cc.worldwidewebb.co`, `app--tye.worldwidewebb.co`, `app--amp.worldwidewebb.co`. (`api--tye` likewise if/when declared.)

### 2. Hardcoded literals updated to match (not derived from the template)
- `products/control-center/web/capacitor.config.ts:16` → `https://app--cc.worldwidewebb.co`
- `products/control-center/web/capacitor.config.test.ts:24` assertion
- `products/text-your-ex/apps/api/src/server.ts:9` CORS allow-list entry
- `products/amp/src/App.tsx:8` displayed route + `products/amp/src/App.test.tsx:13`
- every assertion in `infra/cloudflare/test/routes.test.ts` and `infra/cloudflare/test/access.test.ts`
- `products/text-your-ex/README.md` health-check/TestFlight URLs

### 3. ACM deleted entirely (it's now dead)
- remove `infra/cloudflare/src/tls.ts` and `infra/cloudflare/test/tls.test.ts`
- remove from `infra/cloudflare/program.ts`: the `tls.ts` import (line 24), `applyNestedTls` flag (35-39), the `if (applyNestedTls)` block (183-189), and `nestedTlsEnabled` output (197)
- **Proof:** `grep -rn 'applyNestedTls\|CertificatePack\|nestedTls' infra/cloudflare` returns empty.

### 4. Docs match reality (the design assumed paid ACM; it no longer does)
- `docs/platform/NETWORKING.html` + `README.html`: the "nested product hostnames are intentional / `*.worldwidewebb.co` does not cover `app.cc`" contract is rewritten to the flattened single-label scheme.
- `docs/go-live-runbook.md`: the "KEYSTONE: enable ACM" section is replaced with "hostnames flattened, free TLS, no billing action."

### 5. Gates green (run each, show output, none weakened)
- `bun run typecheck` exits 0
- `bun run test`, 0 failed, **0 skipped**, no test deleted or weakened to pass
- `bunx biome check` (lefthook/CI form on explicit paths if run from a worktree) exits 0
- `bunx knip` exits 0 (zero findings; deleting `tls.ts` must not orphan an export)

### 6. Shipped
- commit `type(networking/www-kbiy): …`, merged to `main` with **NO PR**, pushed, `git status` clean
- CI green; the `deploy` job runs `pulumi up` and rolls the cloudflare stack (routes + Access now on flattened hosts)

### 7. Verified live in prod (the real proof)
For each of `app--tye`, `app--cc`, `app--amp`.worldwidewebb.co:
```
curl -s -o /dev/null -w "%{http_code} ssl_verify=%{ssl_verify_result}\n" https://<host>
```
- `ssl_verify=0` (handshake succeeds, the whole point), and
- a real HTTP status: `app--tye` → 200 (public); `app--cc`/`app--amp` → 302/403 (Cloudflare Access redirect/deny, which proves the route AND that Access still guards it).
- State each result in the transcript (the evaluator can't run curl). Screenshot `app--tye` loading in a browser at its real surface and describe what it shows.

### 8. No regressions
- `dashboard.worldwidewebb.co` (legacy CC) still returns 200.
- No new errors; `main` clean.

## Explicitly OUT of this goal (still human-gated, do NOT attempt here)
- **CC P0 prod data migration** (`www` M7.7), irreversible, needs Calum's explicit go + a cutover window.
- **app.cp captive-portal cutover**, separate LAN/UniFi op.
- **Physical on-glass tests**, iPad panel, guest WiFi on a phone (Calum only).
- **M9 cosmetic renames** + **per-product-namespace re-audit `www-r3it`**, separate epics; this goal does not touch namespaces or package scopes.
- iOS TestFlight rebuild for the new `app--cc` URL, code change lands here; the rebuild/ship is a later step (kiosk isn't cut over to `app.cc` yet, so no live impact).

## Boundaries
- Do the work in a git worktree named `www-kbiy-domain-flatten`; merge to `main` locally, no PR.
- Do not touch namespaces, package scopes, or image names (those are `www-r3it` / M9).
- Do not weaken/skip/delete any test to make gates pass. If flattening breaks a test, the test assertion updates to the new host, it must still assert the host.
- Real verification only, no claiming a route is live without the curl/ssl_verify evidence in the transcript.
