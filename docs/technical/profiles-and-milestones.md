# Profiles and milestones release plan

Owner-approved product direction: November 8, 2026. Planning is complete; implementation and acceptance remain open. Deliverable: [#71](https://github.com/0x63616c/folding/issues/71), **In progress**, under F07 (#8), with existing leaderboard/profile work in #34/#35.

## One release

Deliver browsable participant profiles, two sequential milestone tracks, private next-target progress, the complete earned-badge collection, one optional featured badge, leaderboard badge display, and grouped unlock celebrations in one app release. Internal implementation steps are dependencies within that release, not separate launches. Do not ship profiles first and postpone milestones or featuring to a second release.

Keep Today, History, Leaderboard and Settings. Use the term **Milestones** for progress and **Earned badges** for the rewards. Do not introduce a separate level number, XP, streak, achievement feed, daily fold target, or timed folding challenge.

This plan extends the existing product/UI/security contracts for the named feature. It does not claim that the feature is implemented or that provider, device or shipping acceptance has passed. Existing CI, storefront/visual review, submission and post-submission physical-device deferrals remain explicitly tracked.

## Navigation and screens

### Your profile

The existing Leaderboard profile toolbar button opens a profile summary rather than the edit form. The current user's pinned row and own leaderboard/podium entry open the same profile. Add a Your Profile shortcut in Settings for joined participants. Before joining, retain the existing opt-in flow; no profile is published automatically.

Order: avatar and display name; featured badge if selected; accepted All Time competition fold total; two compact next-milestone rows; Earned badges preview and See All; Edit Profile. Keep existing account-management actions accessible through Edit Profile. Edit Profile retains name/photo editing and links to badge selection without duplicating the full collection.

Selecting either progress row or See All opens **Milestones**, containing Next milestones followed by Earned badges. Each progress row shows the track, next target, current value and progress bar. All new destinations use native navigation within the existing presentation flow; do not stack competing sheets or add a tab.

### Another participant's profile

Tap a leaderboard row or a podium participant to open their profile; tied podium groups retain their participant picker, then open the chosen person. Show current published avatar/name, optional featured badge, accepted All Time folds and all earned badges. Preserve the selected leaderboard period and scroll position on return. Period-specific ranks/crowns remain attached to their originating period, never presented as a permanent profile award.

Other participants never see locked badges, next targets, partial progress, day-by-day activity, sessions, home timezone, upload state, precise unlock times or account/moderation internals. Badge details show the requirement, without private activity evidence. Keep reporting available using the existing moderation flow. Handle removed, restricted or deleted profiles with a concise unavailable state.

Public here means visible to eligible members of the existing signed-in leaderboard community, not an unauthenticated website or discoverable public URL. Explain the addition of profile/badge visibility in the join flow and the release's privacy copy; no Apple name/email is automatically published.

## Two sequential tracks

**Folds** uses these stable milestone IDs, thresholds and initial English names:

- `folds_1`: First Fold — 1 eligible fold.
- `folds_100`: Getting Into It — 100 eligible folds.
- `folds_1000`: Four Figures — 1,000 eligible folds.
- `folds_10000`: Well Used — 10,000 eligible folds.

**Days used** counts distinct UTC calendar days containing at least one eligible counted fold:

- `days_7`: Part of the Routine — 7 different days.
- `days_30`: Daily Companion — 30 different days.

Days need not be consecutive; multiple folds in a day still count one day. UTC follows competition's calendar rules, independently of private home-timezone charts. Mention that boundary only in optional milestone help. Artwork and names distinguish the two tracks without requiring color recognition.

Show exactly the first unmet target per track. At 640 folds, show **1,000 folds**, **640 / 1,000**, and a 64% progress bar. Do not show the 10,000 badge, target, silhouette or future-level count before 1,000 is earned. At 1,000, add Four Figures to the earned collection and replace that track's target with 10,000. Likewise, show 30 days only after 7 days is earned. If one upload crosses multiple thresholds, grant all reached badges and show only the next unmet target.

When a track's final target is earned, replace its progress row with a compact completed-track state; do not leave a full progress bar suggesting another locked target or invent future thresholds. Advancing never removes earlier badges.

## Earned collection and featuring

The Milestones screen lists every currently earned badge, newest first with stable catalog order for ties. It does not contain locked future badges. Your profile shows a compact preview with See All; another participant's profile exposes their complete earned collection. Zero earned badges get a short owner prompt toward the first milestone; visitors simply see no collection section.

Tap a badge for its larger artwork, name and requirement. Owner detail additionally shows the earned calendar date when backed by eligible event history. Feature on Profile selects it; the current selection offers Remove from Profile. One optional featured badge per profile; a new unlock never changes the selection. Show a selected state and let users switch from either badge detail or Edit Profile. Public badge details have no editing controls.

Show the featured badge below the profile name and as one small symbol beside the name in leaderboard rows/podium participant details where readable. Gold/silver/bronze rank crowns remain a separate avatar overlay. Supply accessible badge names and do not bake crowns/badges into the uploaded avatar. No paid or user-created badges in this release.

Only the service may decide which badges are earned. A feature request accepts an earned catalog ID or null, rejects another participant's/unearned/unknown badge, and returns the authoritative selection. Persist changes across devices. Failed saves retain the last confirmed public selection and offer Retry; an offline choice is not falsely shown as publicly saved.

## Eligibility and earning

Badges belong to the competition profile and use the same current-generation, post-join, eligible counted folds as the accepted All Time score. They are not lifetime private-history totals. Use “recorded since joining” in optional requirement details, including the current reset boundary where relevant. Personal tracking continues without joining, but this release does not introduce a separate private achievement system or upload pre-join history.

Reuse the authoritative scoring reducer and current incomplete-entry eligibility rules. An accepted observation may count zero; count transitions, not HTTP receipts or raw uploaded events. Exclude setup tests, duplicates, rejected/quarantined observations, inactive-epoch uploads and erased generations. Enforce existing active-phone transfer rules. A day qualifies only if its final eligible reduction includes at least one counted fold.

Existing participants receive all reached badges from retained eligible accepted history at rollout, not just activity received after installing the new app. Do not add pre-join private folds to make an award. Derive earned dates from deterministic event-time reduction when that evidence exists; omit a date rather than invent one. An owner with many existing awards receives one grouped introduction, not six consecutive celebrations.

Offline recording continues normally. Progress and awards update after service acceptance; show confirmed cached progress offline with a compact update-pending indication only when relevant. Never add pending local folds to public badge progress. Phone transfers/reinstalls preserve the same profile's valid awards and selection.

Late uploads, replay, quarantine approval and score corrections trigger the same milestone recomputation as score changes. Reconcile progress/awards against the authoritative eligible set. Remove an award if corrected eligibility no longer reaches its threshold and clear a now-invalid featured selection atomically. Do not silently preserve an invalid badge or treat a correction as a new fold. Ordinary progress retains all previously reached lower milestones.

## Unlock presentation

After confirmed service awards, show one small Badge earned sheet at the next safe foreground opportunity, with View Badge (View Badges for a group) and Done. Queue it behind setup, join, account operations, errors and other active presentations. Respect Reduce Motion; no push permission, added push category or interrupting Shortcuts/background tracking.

Persist acknowledgment by participant, generation and milestone ID so refreshes, retries, reinstall and another phone do not replay an acknowledged celebration. A correction that revokes/re-earns the same milestone does not cause repeated original celebrations. Never acknowledge unseen awards merely because a background request fetched them. Group a batch's awards and acknowledge the displayed group on dismissal; failure to save acknowledgment must not repeatedly interrupt the same open session.

## Data and API implementation work

Before implementation, amend `http-contracts.md` and typed Swift/Rust DTOs together with fixtures. Proposed operations are: owner milestone/progress read; eligible member profile/earned-badge read by participant ID; featured-badge update; displayed-award acknowledgment. Exact route names and schema definitions are implementation work, not already-live endpoints.

- Keep the milestone catalog finite and versioned, with stable IDs, track order, integer threshold, localized name/requirement keys and bundled artwork references. Clients do not submit thresholds, counts, eligibility or earned dates.
- Persist profile/generation-scoped grants, featured selection, acknowledgment and computation revision with guarded uniqueness/idempotency. A monotonic revision binds own progress, grants, public All Time total and featured selection to a consistent snapshot.
- Reuse scoring deltas/eligible-day aggregates; avoid full-history scans on profile reads or every fold. Full replay/backfill is bounded, resumable and revision-fenced; it cannot publish partial awards, resurrect erased users or overwrite a newer reset/correction.
- New public profile payloads are explicit allowlists: participant ID, visible name/avatar, accepted All Time total, earned badge IDs and optional featured ID. Keep progress, precise timestamps and lifecycle/abuse metadata in owner-only payloads.
- Reads require the existing eligible community authorization and current target visibility. Recheck moderation/deletion on cached reads; invalidate copied profile/badge projections and avatars on removal. No unauthenticated profile lookup or new public asset access.
- Feature/ack writes require the existing authenticated account guards, operation idempotency, ownership checks and rate limits. Do not require working fold-ingestion attestation merely to edit a profile or delete an account; never weaken ingestion attestation.
- Use additive schema/client changes and capability gating. Older builds continue working. Deploy compatible service/schema changes first, verify the full feature, then enable the complete experience for the release's supported app build. Deployment ordering is not permission for a profiles-only product release.

## Lifecycle and privacy

Reset history clears this generation's progress, earned badges, featured selection and celebration state along with scores. Update the destructive confirmation to name badges, and fence stale reads/uploads/background recomputations. A pending offline reset suppresses the owner's obsolete local badge display immediately; service confirmation governs removal visible to other members, with existing pending/retry disclosure retained.

Competition account deletion removes profile/badges/selection/acknowledgments and invalidates public copies through existing durable cleanup. Restrictions suppress the profile immediately and prevent featuring changes; preserve appeal/deletion access. Ordinary logout does not reset awards, but clears account-bound local projections so another sign-in cannot see them. Switching phone, reinstalling or refreshing a session is not a new identity or a history reset.

Confirm schema retention, privacy policy and account-data export coverage for badge/selection data. Do not leak server-only security evidence through export. Do not introduce a retired Leave competition action while extending lifecycle handling.

## Implementation sequence within the same release

1. Amend schemas/contracts/catalog and deterministic reducer/eligible-day fixtures; add migrations, backfill and guarded service reads/writes with lifecycle cleanup.
2. Build self/other profile navigation, milestone progress, full earned collection, detail/featuring, leaderboard display and acknowledgment/celebration behavior against the same revisioned data.
3. Finish six badge artworks, all supported localizations, accessibility, privacy/reset copy and focused integration verification. Validate compatible staging service/client behavior and prepare one app release containing the entire feature.

No step is a separate feature launch. No implementation or deployment is performed by this planning task.

## Acceptance checklist

- [ ] Catalog/DTO/API/schema amendments cover every read/write and preserve older clients.
- [ ] All six badge assets and localized names/requirements are bundled; artwork is readable at row and detail sizes, in both appearances and increased contrast.
- [x] Folds show only 1 → 100 → 1,000 → 10,000; days show only 7 → 30; exact boundaries, multi-award batches and completed tracks behave correctly. Local domain, typed-client and direct production-view evidence is recorded in the implementation checkpoint; broader live/release acceptance remains open.
- [ ] Progress uses eligible counted folds and distinct UTC days; duplicate, zero-count, setup, incomplete/ineligible, rejected/quarantined, transfer, midnight and late/replayed events are covered.
- [ ] Existing participants backfill correctly; reads/updates remain bounded on realistic histories and cannot publish a stale reset/deletion generation.
- [ ] Own profile, Settings shortcut, leaderboard/podium/tie-group entry, other profile, complete earned collection, badge detail and Edit Profile work together; navigation position is retained.
- [ ] Featuring is optional, one-at-a-time, server-owned and persistent; unearned/foreign/unknown IDs and lost/duplicate responses are covered.
- [ ] Only owners see next progress and earned dates; member reads never reveal private history, pending totals, timezone or restricted/deleted profiles.
- [ ] Cached/offline progress, upload acceptance, failed profile reads/saves, account switching, reinstall and phone transfer behave as specified.
- [ ] Grouped celebrations respect presentation priority and durable acknowledgment; no repeated unlock barrage or new push category.
- [ ] Reset/delete/moderation/correction revoke the correct data and invalid selection; stale caches/jobs cannot resurrect them. Reset copy includes badges.
- [ ] Dynamic Type, VoiceOver progress/selection labels, Reduce Motion, narrow/wide layouts and supported-language formatting are checked. Prefer direct XCTest rendering for static screens; coordinate/clean up any required runtime use.
- [ ] Verify the integrated service/client feature with linked commit, local/staging evidence and one release manifest covering all parts. Keep deferred CI/storefront/visual/submission checks explicit; do not claim them passed.
- [x] Add feature-specific physical-device checks to #47/F13, retaining the owner-approved post-submission deferral. Six unchecked hardware checks are tracked there; broader shipping remains incomplete until those checks and resulting fixes are done.

References: [Product](../review-spec.md), [UI](ui.md), [HTTP](http-contracts.md), [Security](backend-and-security.md), [Tracking](storage-and-tracking.md), [deferred shipping](../deferred-shipping-work.md).
