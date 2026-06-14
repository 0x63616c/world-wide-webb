# Legacy route retirement checklist: `dashboard.worldwidewebb.co` (www-jtp0.7.11)

Control Center's private app route is now `app.cc.worldwidewebb.co` (behind a
Cloudflare Access kiosk service-token policy). The legacy public host
`dashboard.worldwidewebb.co` is kept alive as temporary compatibility until the iOS
TestFlight build and the wall panel are verified on the new route. This is the
ordered, REVERSIBLE checklist for retiring it. **Nothing here runs without Calum's
explicit approval, and not before www-jtp0.7.10 (wall-panel verification) passes.**

## Do NOT retire until ALL of these are true

- [ ] www-jtp0.7.7 production data cutover complete and verified.
- [ ] www-jtp0.7.8 iOS kiosk shipped: a TestFlight build defaulting to
      `https://app.cc.worldwidewebb.co` is installed on the iPad.
- [ ] www-jtp0.7.10 wall-panel verified healthy at 1366×1024 on `app.cc`
      (`scripts/verify-wall-panel.mjs` PASS + human screenshot review).
- [ ] The installed kiosk has run for a soak period on `app.cc` with the watchdog
      recovering normally (no fallback to the legacy host).
- [ ] Calum explicitly approves retirement.

## Where the legacy route is declared (what to remove)

| Location | Entry | Action |
|---|---|---|
| `infra/cloudflare/src/routes.ts` | `LEGACY_INGRESS.dashboard` + `LEGACY_CNAME_COMMENTS` | remove the `dashboard` ingress + CNAME entry |
| `packages/platform/src/index.ts` | `legacyHostname: "dashboard.worldwidewebb.co"` on the CC manifest | drop the field once nothing references it |
| `infra/cloudflare` Access | any Access app still scoped to `dashboard.worldwidewebb.co` | remove the legacy Access app |
| Tests | `infra/cloudflare/test/routes.test.ts` (asserts `dashboard.worldwidewebb.co` present) | update to assert it is ABSENT after retirement |

## Retirement steps (reversible)

1. Remove the `dashboard` entry from `LEGACY_INGRESS` and its CNAME comment in
   `routes.ts`; drop `legacyHostname` from the manifest.
2. Update `routes.test.ts` / `exposure` tests: the legacy host must now be asserted
   ABSENT (red-first: flip the existing presence assertion).
3. `pulumi preview --stack prod` (cloudflare stack): confirm the ONLY change is the
   removal of the `dashboard` ingress/CNAME/Access app, nothing else rolls.
4. With approval, `pulumi up`. The tunnel stops routing `dashboard.worldwidewebb.co`.
5. Verify `app.cc` still serves and the iPad is unaffected.

## Rollback

Retirement is reversible by restoring the prior Pulumi config: re-add the
`dashboard` `LEGACY_INGRESS`/CNAME + `legacyHostname` and `pulumi up`. The CNAME and
Access app are re-created from declaration; no data is involved. Keep this checklist
and the prior `routes.ts` revision until the retirement has soaked.

## Grep gate (no misleading load-bearing old-path instructions)

Before closing www-jtp0.7.11, confirm no doc/code still tells an operator or build to
USE the legacy host as the live route (historical/legacy mentions that are clearly
labeled as such are fine):

```bash
# Surfaces every remaining reference for review; each hit must be either
# retired or clearly annotated as legacy/historical.
grep -rn "dashboard.worldwidewebb.co" --include='*.ts' --include='*.tsx' \
  --include='*.md' --include='*.yaml' --include='*.yml' . \
  | grep -v node_modules
```

Remaining acceptable references after retirement: this checklist, the cutover
runbook's "what stays live → then retired" note, and any clearly-historical design
doc entry. The shipped iOS default (`capacitor.config.ts`) and the live route
declaration must NOT name the legacy host.
