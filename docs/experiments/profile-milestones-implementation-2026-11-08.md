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

## App interface and cache checkpoint

The profile summary now opens from Leaderboard's toolbar, own row and Settings. Other rows/podium/tie-group entries open the selected participant without replacing the board stack. Edit Profile retains the existing name/photo/account form. Milestones shows only the next target in each track, compact completed-track states and the full earned collection. Badge detail features/removes one earned selection; live/historical row models display the optional badge separately from crowns. Six bundled monochrome vector assets are reproducible through `scripts/generate-milestone-badges.py` and need no font/image download.

Owner snapshots and feature/acknowledgment retry intents are scoped to participant and reset generation. Cache writes and UI publication reject older revisions. Account changes, reset and pending entry deletion fence progress; late account reads cannot restore it. Failed featuring retains the confirmed selection. Public profiles are not persisted and refresh while visible; request/context guards reject stale replies. The Settings profile navigation resets when the competition identity changes. Existing async guards also recheck identity after generation lookups before writing a retry/cache record.

Unlocks group confirmed unacknowledged awards behind setup, existing sheets, errors and account operations. Only a displayed group is acknowledged on dismissal. A persisted acknowledgment queue survives a lost connection/relaunch, while local seen state prevents a repeated celebration during the same session. No push category, automatic featuring, XP or streak was introduced.

All 35 new semantic keys plus reset-copy updates have ten-locale catalog values; `check-localization.py` verifies **237 keys × ten locales**, and ten localization regressions pass. Join copy names profile/badge visibility; reset copy names badges. Privacy/deletion website source now covers badge/selection/acknowledgment retention, private progress, reset/deletion cleanup and competition-data access through the existing privacy contact. Website build passed; these pages have not been deployed by this checkpoint. Native-speaker/final localization review stays deferred.

### App evidence

- **65 app-hosted XCTest cases passed**, including eight milestone model/cache/presentation cases and one production-view render case. Existing transport/Keychain/app composition regressions pass with the repository's ad-hoc simulator entitlements. The initial unsigned attempt failed Keychain-dependent tests (`-34018`); that configuration error was corrected and is not counted as a successful run.
- Model cases cover fixture decoding/next progress, explicit-null removal, malformed future target/unearned selection, account/reset cache fencing, persisted feature/ack retry identity, failed/offline featuring, late account response rejection, safe grouped unlocks/failed acknowledgment suppression, and older response/cache rejection.
- The production views were rendered directly through XCTest/UIHostingController, with no simulator UI automation: narrow owner profile, progress toward 1,000, public profile, badge detail in dark appearance, completed wide collection, accessibility-size collection and six-artwork sheet. Local inspection corrected redundant grid chevrons and the renderer's inherited-window inset/viewport issue. These are preliminary feature renders, not final storefront/full-app visual acceptance.
- Full passing suite: `build/milestones-ui-final.xcresult`, `/tmp/folding-milestones-ios-final-tests.log`. The renderer-only inset correction also passed: `build/milestones-render-check.xcresult`, `/tmp/folding-milestones-render-check.log`. Final seven exported attachments and manifest: `build/milestone-renders-checked/` (ignored intentional evidence). Latest app/test-target build passed after the small cached-detail retry and Settings identity-navigation adjustments.
- Each test device was created for this task, app/test activity terminated, shut down with state readback and deleted in a `finally` cleanup. Receipts in `build/runtime/milestone-simulator*.json` record each attempt. Existing `Folding-Refinements-Review` and `Panel Personal Duo Review` sessions were preserved; the Simulator app was never opened.
- Six feature-specific hardware checks were added, unchecked and explicitly post-submission deferred, to [#47/F13](https://github.com/0x63616c/folding/issues/47). No physical-device pass is claimed.

### Still required

Complete the remaining lifecycle/race and realistic large-history/resource checks, release capability/compatibility gating, integrated staging service/client verification, and one combined internal release with implementing commit/provider/Apple readback evidence. Final accessibility/native-language/storefront/full-app visual review, CI and App Store submission retain their recorded deferrals. #71 remains In progress; no provider mutation or distribution occurred during this UI checkpoint.
