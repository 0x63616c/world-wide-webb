# API resource protection and idle-cost reduction — November 8, 2026

Scope: local implementation and verification for #55, under F03/#4. This is not evidence of a deployed Worker, a new TestFlight build, physical folds, or 1,000/10,000-user capacity. Existing CI, storefront, submission and device deferrals remain unchanged.

## Implemented

- Environment-isolated network/authentication/credential burst counters before body processing, D1 and signature verification; existing authoritative business limits remain.
- Rejected burst/4xx event requests do not create ingestion-metric writes.
- Five-minute due-work selection, hourly retention/expired-avatar discovery/period catch-up, direct monitoring, unchanged-value alert-write suppression, and queue batches of ten. Pending/failed dispatches retain retry identity and manual-review fencing.
- Indexed adjacent-observation reads and guarded score deltas replace the full-history read on each new event batch. Migration 0019 is additive.
- Shared one-minute event upload cooldown; batches retain up to 256 observations and privacy/reset priority.
- Persisted server cooldowns, non-JSON and HTTP-date support, coalesced leaderboard/results reads with a 15-second cache and mutation/session invalidation.
- Generated 5-second CPU limit and 10% structured-log sampling without automatic invocation metadata.

## Verification

- Rust workspace: six domain contract tests and 24 Worker tests passed. Differential scoring compares indexed subsets against full replay over 300 shuffled seven-event batches, including late arrivals, repeated states, duplicates, test events and clock reversals; checks total and period-bucket deltas and index selection.
- Native and Wasm Clippy pass with warnings denied; Rust formatting passes. Small pre-existing lint findings in auth/certificate helpers were corrected without changing their intended behavior.
- Compiled Wasm Worker packaged successfully; ten local workerd/D1 tests passed, including forged/rotated credential flood rejection, network isolation, zero rejection metric writes, due-category selection, pending/failed retry preservation, participant-scoped neighbor reads and negative score-delta atomicity.
- Swift package: 75 tests passed, including shared cooldown/reopen and combined-transition coverage. This run also contains unrelated in-progress local UI/history work; those edits are excluded from this change's commit.
- Focused app-hosted simulator transport suite: four tests passed, covering persistent server cooldowns, image gating, concurrent read coalescing, cache expiry/invalidation and Retry-After parsing, plus existing enrollment/session regressions.
- Configuration regeneration regression passed, including CPU/log/rate/queue defaults and preservation of reviewed feature gates.

Local logs live under ignored `build/resource-*`. Tests use synthetic identities and local databases; no production credentials or user event bodies are saved in this evidence.

## Rollout and remaining acceptance

1. Verify current staging/production versions, bindings, flags and migration ledgers against the live-integration checkpoint; preserve those reviewed values. Generate configs using the exact implementing source commit, not unrelated workspace edits.
2. Apply migration 0019 through the existing checksum wrapper, deploy staging, verify health/version, rate-limit bindings and sampled safe route logs. Exercise scheduled idle/due paths and old/current client compatibility.
3. Deploy the same compatible Worker/config to production only after staging acceptance. Verify readback and observe another full 24-hour window. Roll back code/config if needed while retaining additive indexes.
4. Ship the iOS client through Fastlane/internal TestFlight separately. Existing installed builds retain the former 15-second upload interval until updated.
5. Keep billing-alert delivery, physical-device acceptance, realistic load tests, distributed-abuse mitigation and device-informed cheating thresholds explicitly open. App Attest does not prove physical folds; no automatic permanent-ban threshold was invented.

Burst counters are permissive and local to each Cloudflare location. They reduce D1/crypto amplification but requests still invoke the Worker; these protections are not a global quota or a hard monthly bill cap.
