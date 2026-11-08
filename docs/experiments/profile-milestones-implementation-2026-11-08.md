# Profiles and milestones implementation checkpoint

Issue [#71](https://github.com/0x63616c/folding/issues/71), branch `codex/profiles-milestones`. The [complete plan](../technical/profiles-and-milestones.md) remains one release. This checkpoint is internal code progress, not a partial feature release, deployment or TestFlight distribution.

## Implemented and locally verified

- The finite six-badge Rust catalog, sequential next targets and accumulated earned milestones; UTC distinct-day counting and contribution-delta cancellation.
- Additive migration 0021: resumable projection state, counted-event/day indexes, grants, optional featuring with earned-grant foreign key, durable acknowledgment independent of grant revocation, and account ownership cascades. Migration is not applied to either provider environment.
- Compiled service routes: owner-only progress/dated grants; authenticated member-visible participant profiles with an explicit public field allowlist; one optional earned featured badge; idempotent displayed-group acknowledgment. Generation/revision/session/target visibility fences and existing rate limits guard reads/writes. Neither progress nor unlock times enter public profile payloads.
- A 256-observation keyset backfill preserves causal transition state across pages and user-deleted observations. Building projections never return partial awards. Queue dispatch processes bounded pages and continues remaining work; cron can recover pending dispatch. It rechecks account, current generation and participant revision before publishing. Profile reads do not scan full histories.
- Incremental milestone changes commit in the same guarded transaction as scoring. Full deletion/moderation replay also updates the projection; newly selected badges appear in live and historical leaderboard projections separately from period crowns. Reset/rejoin clears reward state; deletion reuses the reward purge through existing lifecycle cleanup.
- Typed Swift badge/progress/owner/public DTOs and API methods. Client validation rejects malformed next targets, mismatched grant sets and unearned featured selections; removal explicitly encodes null and includes the generation. The shared JSON fixture exercises both languages. Three app-hosted XCTest cases compile; the actual model validation/encoding also ran in a native Swift harness using the real tracking generation type.

## Evidence

- Rust workspace: **46 tests passed** (seven domain units, seven domain contracts, 32 Worker host tests). Includes milestone threshold/reveal/correction rules, shared fixture and schema/delta constraints.
- Optimized Wasm Worker build passed. Full local workerd/D1 suite: **21 tests passed** (16 existing and five new feature integration tests).
- New runtime cases execute the actual routes and database: initial backfill and owner/public projection; unearned selection/retry/conflicting operation; acknowledgment retry; moderation visibility; 640-observation multi-page backfill with a deleted transition; entry deletion revoking a badge and selection while preserving acknowledgment; real locally signed App Attest uploads, duplicates, quarantine, reset and stale-generation rejection; featured badge in the All Time leaderboard; late causal insertion changing distinct days without changing total folds.
- Unsigned generic-device app build passed. Generic-simulator **build-for-testing passed**, compiling the application and all test targets with the shared fixture bundled. No simulator was booted and app-hosted XCTest execution is not claimed.
- Native execution of the actual Swift models passed fixture validation, only-next-target/progress assertions, public-profile validation, malformed future-target rejection, unearned-feature rejection and explicit-null/generation-fenced removal encoding. This does not verify UI navigation or account caches.
- Swift formatting/lint and `git diff --check` passed.

Local logs: `/tmp/folding-milestones-host-tests.log`, `/tmp/folding-milestones-build.log`, `/tmp/folding-milestones-runtime-tests.log`, `/tmp/folding-milestones-ios-build.log`, `/tmp/folding-milestones-ios-test-build.log`. Logs contain synthetic/local test identities, not provider credentials. No credential lookup, deployment or simulator session was used.

## Required before the single release

- Wire self/other profile navigation and Settings/podium/tie-group access; all six badge artworks; owner next-target rows, completed tracks, earned collection/detail and featuring; grouped safe-priority celebrations with durable acknowledgment.
- Fence account/generation-scoped confirmed client caches and pending reset, refresh after upload acceptance, retain authoritative selection on failed saves, and prevent account/phone/reinstall cache leakage.
- Complete ten-locale copy, accessibility/direct rendering, privacy/join/reset copy and account-data export coverage.
- Extend relevant runtime/client cases for account switching/transfer, deletion/restriction races, acknowledgment failure/relaunch, moderation replay and realistic large-history backfill/resource behavior. The current 640-row case is bounded-pagination evidence, not a 100k load acceptance claim.
- Verify the complete staging service/client flow, then prepare one integrated release with all product parts. No profiles-only launch. Keep owner-deferred CI, storefront/visual review, App Store submission and #47/F13 post-submission device checks explicit and unpassed.
