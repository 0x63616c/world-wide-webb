# Folding blocking and account deletion plan

Date: November 10, 2026.
Status: implementation complete locally; final checks and requested Astra PR review precede merge/delivery.

## Scope and decisions

Implement usable blocking and accessible account deletion in one coherent Folding release.
Image scanning, moderation-service signups, manual photo approvals and preset avatars are deferred.
Keep reports, existing name checks and administrator moderation. No guarantee of App Review approval.

- Blocking replaces another member's identity with a neutral **Blocked player** row, keeping their
  original score and rank. Hide their name, photo, badge references and profile navigation everywhere.
- Blocking affects the viewer's experience, not the other member's eligibility or anyone's rank.
- Allow unblocking from Settings without opening the blocked profile.
- Delete competition account is available to existing signed-in accounts before Join, after Join,
  and while suspended or banned. Joining or contacting support must not be a prerequisite.
- Private fold history remains separate from competition-account deletion, with Reset history still available.
- Keep implementation/fixes local until reviewed, then follow normal required checks and delivery.
- User wants plans and findings directly in chat or ordinary files: do not create audit canvases.

## Starting evidence

The audited submitted artifact is **1.0.0 (21)**, source
`66a37a32b4d191e5384a4e0d04c0f627e49ee7ac`.
Apple build ID: `15d56e44-0361-43e3-91ac-33ff5baad4bd`.
Submission: `e84499a5-8bee-4deb-93f0-6cfbf5fc4bb3`.
Readback on November 10 confirmed Waiting for Review with all three consumable tips and automatic
release after approval. Recheck Apple state before delivery; this is a dated observation.

The preserved IPA matches SHA-256
`a8e272102b18b7602bf17eaf5a8b0120a20d6b8f7a188e0a3c17e731d1d3cc77`.
Audit source checkout: `/Users/calum/.worktrees/world-wide-webb/codex/folding-app-store-on-merge`.
Working plan checkout: `/Users/calum/.worktrees/world-wide-webb/codex/folding-blocking-deletion-plan`.

The existing implementation already has block/unblock storage and API methods, global ranking
before block filtering, avatar block guards, deletion cleanup, native Apple reauthentication and
Apple token revocation. Current gaps are UI access, anonymous-row projection, direct-profile access,
stale presentation, and truthful deletion recovery. Prefer extending those handlers.

## 1. Separate account state from leaderboard eligibility

- Track known account existence, usable authentication and leaderboard eligibility separately.
  `competitionJoined` must not control whether an existing account can be deleted.
- Preserve/restore account existence through cancelled Join, relaunch, restriction and session expiry.
  Expired authentication should offer Apple reauthentication, without requiring Join or restoring
  community access to banned/suspended accounts.
- Show Delete competition account in Settings whenever an account is known to exist. No account
  should be created merely to reach deletion or recover its status.

Primary files under `apps/folding/apps/ios/App`:
`AppController.swift`, `FoldingPresentation.swift`, `FoldingScreens.swift`,
`ProfileIdentityEditor.swift`, `CompetitionSignIn.swift`, `CompetitionTransport.swift`.

## 2. Complete deletion behavior and recovery

- Reuse the existing deletion request, operation ID, Apple proof, polling receipt and cleanup jobs.
  Deletion/reauthentication already use privacy authorization that allows restricted/nonjoined accounts.
- Confirmation must explain that the competition account, profile/photo, scores/results and associated
  competition data are removed, while private fold history remains. Keep copy concise and localized.
- On accepted deletion, immediately remove public participation and prevent further public uploads.
  Persist the operation across termination/offline periods and clear account credentials/caches only
  at the appropriate confirmed stage.
- Distinguish pending work, automatically retryable failure, cleanup needing operator action, and
  completed deletion. Do not show indefinite generic progress when a cleanup job stopped retrying.
  Current Retry only polls/recovers status; it does not restart terminal failed jobs. Extend existing
  retry/status handling rather than starting another deletion or claiming that polling repairs cleanup.
- Handle Apple revocation failure, avatar cleanup failure and a lost response explicitly. Expose only
  sanitized actionable status, never tokens or provider payloads. Preserve authorization/idempotency.
- Define recovery when a saved operation is resumed after the server's 30-day receipt retention ends.
  An expired/unknown receipt must not be treated as proof of success, nor trigger ordinary sign-in
  that recreates an account. Select the smallest truthful recovery outcome during implementation.
- Check actual deleted/retained records against the privacy notice: 30-day recovery mapping,
  active restriction records and moderation evidence. Do not assume a moderation label itself
  establishes an exception to account deletion. Update disclosures only to match implemented behavior.

Backend files under `apps/folding/backend/crates/worker/src`:
`deletion_runtime.rs`, `reauth_runtime.rs`, `auth_signin.rs`, `auth_runtime.rs`,
`auth_maintenance.rs`, `lifecycle_runtime.rs`, `retry_runtime.rs`.
Client: `AppController.swift`, `CompetitionRemoval.swift`, removal/status screens.

## 3. Define a compatible blocking contract

- Reuse the existing per-account block list and block/unblock endpoints.
- Add an explicit blocked state to leaderboard entries. Retain stable participant ID and ranking
  fields; supply a neutral non-null nickname for old decoders; clear avatar/badge references server-side.
  New clients localize Blocked player from the explicit state, never from matching nickname text.
- Keep new fields compatible with shipped clients; make decoder defaults explicit and update shared
  contracts/fixtures. Verify old-client decoding against the changed backend before rollout.
- Calculate ranking/population globally, then project blocked entries anonymously. Do not rerank,
  transfer podium awards or change another user's result because someone blocks them.
- Apply equivalent projection to live/all-time and historical board responses, pagination and ties.
- Deny direct blocked-profile reads. Retain and verify avatar access guards; do not rely only on UI hiding.
  One-way viewer blocking is sufficient for this proposed design; it does not globally ban the member.

Backend: `profile_runtime.rs`, `leaderboard_runtime.rs`, `results_runtime.rs`,
`milestone_profiles.rs`, `avatar_runtime.rs`; shared Folding contracts and fixtures.
Client models: `CompetitionAPI.swift`, `CompetitionPresentation.swift`, `FoldingPresentation.swift`.

## 4. Implement controls and immediate visibility changes

- Add Block beside Report in other-member row/context menus and community profile menus.
- Render neutral rows and podium/tie entries using the explicit state. Disable profile navigation,
  clear existing identity content and dismiss an already-open profile when that member is blocked.
- Add Settings > Blocked players with Unblock and meaningful loading/error states.
  Current block-list API returns only IDs: do not fetch blocked profiles to recover display labels,
  or depend on in-memory names that disappear after relaunch.
- Planned small default for identifying neutral entries: a stable non-personal short reference shown
  consistently on anonymous rows and in Blocked players, with collision disambiguation. This avoids
  exposing the blocked name/photo. Handle subsequently deleted or restricted accounts. Reassess this
  presentation choice before implementation if a simpler usable mechanism is found.
- Treat cache invalidation and stale-response rejection separately. Capture/recheck a visibility
  revision around board/profile loads and avatar fetches; invalidate affected presentation requests.
  A pre-block response must not restore identity after block completion. Preserve this on account switch.
- Restore server-backed blocking after relaunch/on another device, and refresh affected views after unblock.

UI: `CompetitionScreens.swift`, `MilestoneScreens.swift`, `FoldingScreens.swift`, `AppController.swift`.
Networking: `CompetitionTransport.swift`; use existing request-identity machinery where possible.

## 5. Focused verification

- [ ] Delete an account after Apple sign-in but before Join; repeat for joined and restricted accounts.
- [ ] Expired authentication can reach deletion without enrollment or new-account creation.
- [ ] Interrupted accepted deletion resumes; duplicate retries do not create duplicate deletion operations.
- [ ] Simulate terminal revocation/cleanup failure: truthful status and intended recovery work.
- [ ] Define/test resuming a receipt beyond its retention interval; never invent completion.
- [ ] Confirm profile/avatar/competition data removal, Apple token revocation and preserved private history.
- [ ] Block/unblock from rows and profiles; ranks, scores, populations and awards stay unchanged.
- [ ] Blocked identities disappear from podiums/ties/pages and cannot be fetched through direct profiles/photos.
- [ ] A delayed successful board/profile/avatar response arriving after blocking cannot restore identity.
- [ ] Blocked list remains usable after relaunch and handles deleted/restricted members.
- [ ] Old-client/new-backend contracts decode; new clients handle pre-rollout responses safely.
- [ ] Run relevant domain/backend/native/localization checks; verify representative physical-device flows.

Use existing test seams and entrypoints. Do not rerun unrelated broad galleries or other products'
acceptance suites to complete this change. Existing F13 device/provider deferrals remain accurately recorded.

## 6. Review and delivery

- Self-review the complete candidate and resolve findings locally. Follow the repository's current
  review rules; another delegated review requires explicit authorization.
- Commit coherent Conventional Commit slices. Publish only after the local candidate is reviewed,
  then pass required checks, merge and verify the intended Folding backend/native delivery.
- Deploy backward-compatible backend changes before relying on the replacement app's new contract.
- Keep the current submission intact while preparing the replacement. Reconcile Apple state at handoff:
  the existing automation can replace a waiting submission but explicitly preserves an in-review build.
  Do not promise unconditional replacement or withdraw/re-submit blindly.
- Update concise review notes with exact Block/Unblock and Delete competition account locations.
  Verify the selected processed build, review state and tip relationships after the authorized handoff.

## Independent Astra review

Completed November 10, 2026 against submitted source `66a37a32`; read-only, no credentials,
implementation, tests or provider changes. Verdict: **coherent; proceed after explicit amendments**.
All five amendments are incorporated above:

1. P1: truthful deletion cleanup failure/status and meaningful recovery.
2. P1: explicit anonymous-row contract with shipped-decoder compatibility.
3. P1: reject stale successful responses independently of cache clearing.
4. P2: usable identification in the ID-only blocked list after relaunch.
5. P2: late receipt recovery and accurate retention/disclosures.

Also incorporated: distinct account/authentication/eligibility state, and preservation of an in-review
Apple bundle. Astra reviewed the plan; this is not a review or verification of an implementation.

Official requirements:
- [Account deletion](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion)
- [User-generated content](https://developer.apple.com/app-store/review/guidelines/#user-generated-content)

Apple requires accessible deletion and UGC safeguards. It does not explicitly endorse anonymous
leaderboard placeholders or prescribe a particular image-scanning service. The user chose to defer scanning.


## Implementation and verification checkpoint

Implementation is local in the WWW `codex/folding-blocking-deletion-plan` worktree. The owner
resumed delivery and requested independent Astra review of the WWW PR before merging. All new
issues and PRs belong in WWW. Image filtering remains deferred in WWW #1005.

Implemented: compatible anonymous live/frozen ranks; direct profile block guards; native Block,
Settings Unblock, and stale board/profile/avatar rejection; distinct known-account state;
existing-account-only Apple session recovery; pre-Join/restricted deletion; truthful cleanup retry,
operator-attention and expired-receipt status; ten-locale copy, review notes and website guidance.

Local verification: scripts/check (17 schemas, 69 contract checks, 248 semantic keys x10 locales,
120 Swift core tests); verify_app (83 simulator tests); scripts/check-backend (Rust workspace,
Wasm build and 33 runtime tests). Focused cases cover global/frozen rank preservation, blocked
profile denial, delayed successful identity responses, shipped DTO compatibility, restricted
existing-only authentication without account creation, and nonjoined/banned deletion cleanup status.
Device/provider checks remain deferred under F13; local evidence does not establish those flows.

Apple read-only check at 2026-11-10T15:10:45Z: version1.0.0 still Waiting for Review. Keep the current
submission intact until the replacement is ready. No deployment/submission mutation has occurred.
Remaining delivery: final source checks, WWW PR/Astra review/fixes, green checks, merge,
backward-compatible backend deployment, processed native replacement and exact Apple readback.
