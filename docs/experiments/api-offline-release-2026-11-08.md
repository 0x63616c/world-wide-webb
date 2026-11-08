# API protections and offline release — November 8, 2026

PR #61 merged as `4f8180d1ed91922be50717460ab3558d9dfba2f9`, after integrating main's durable Shortcuts capture, Join assertion verification, immediate validated profile publication and review-request timing. This checkpoint ships API protections and the owner-selected minimum-build gate without activating a floor.

## Local checks

The merged source tree passes **109 core tests**, **53 app-hosted tests**, **34 Rust tests** and **15 compiled Worker/D1 tests**. Native/Wasm checks, 207 keys × ten locales, ten localization regressions and compiled ten-locale/40-plural checks pass. App-hosted tests cover offline cold reopening/account isolation and durable capture/replay; the combined replay path still schedules bounded uploads independently of local capture. No physical-device pass is claimed.

## Provider rollout

Staging then production verified all **19 checksum migrations**, including additive `0019_resource_protection.sql`; released `0018_entry_deletions.sql` is unchanged. Both health endpoints report `ok` and the exact merge commit. Both `/v1/client-policy` endpoints return minimum **0**. Existing non-variable resource/secret bindings, compatibility settings, feature flags and empty advertised capabilities were preserved.

- Staging Cloudflare version: `bc0f5837-5482-4922-bd10-0d716e753d9f`.
- Production Cloudflare version: `6b06fa74-2384-4532-a6f3-0e049b2b15d4`.
- Provider settings confirm separate network/authentication/credential rate namespaces, limits 600/60/120 per minute, 5,000 ms CPU cap, 10% application-log sampling and invocation logging disabled.
- Queue configuration uses ten-message batches and concurrency two. Cron remains every five minutes; code selects due categories, with routine maintenance hourly.
- Production App Attest retains builds 2–11 and adds build 12. APNs/avatar flags remain enabled; email alerts remain disabled. Staging retains its existing flags/build allowlist.

Ignored evidence is in the release checkout's `build/ship/`: environment baselines/generated config, checksum migration receipts, deployment logs, health/policy/capabilities receipts and rate/CPU/log-setting readbacks. Local execution logs are in the original checkout's `build/ship-*`.

## TestFlight

Fastlane reserved **0.1.11 (build 12)**, signed app/widget using readonly match, verified source/configuration/entitlements and uploaded the immutable IPA. Apple processed the exact build as **VALID** (`57be91c5-c36c-4d91-ba4e-3e42ddebea6f`), with non-exempt encryption **false**. Fastlane distributed it to **Folding Internal**; an independent App Store Connect readback confirmed exact build membership in that internal group.

Archive SHA-256: `f59d043ec0413cd472e93e08ffdc0788fd999a64b695d9c87ec8db0a1c8ee252`.
IPA SHA-256: `75090747559099b6b23d133964f141db2181f1004f35836c425122a1f272fd21`.
dSYM SHA-256: `6ad0af967fb96fee5d1fd61eee537a78dc0f19de6bf0ee095aa71b41a5dc6c50`.

Release record/artifacts are retained in the private draft `v0.1.11`, with local receipt `build/releases/v0.1.11/release.json`. This is internal TestFlight work, not App Store submission.

## Remaining acceptance

Keep the minimum disabled; any later activation must verify an installable replacement, destination/support and rollback. Existing cloud history needs one verified connection in the new app before offline cold startup. Real airplane-mode/Shortcuts, account-token behavior, second-device reconnection and suspension acceptance remain owner-deferred to #47/F13. CI, storefront review, submission, monitoring/email delivery and a full 24-hour post-rollout cost observation remain unverified; no billing reduction percentage or load-capacity claim is made.
