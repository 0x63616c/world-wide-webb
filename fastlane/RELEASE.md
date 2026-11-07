# Folding release operations

This is implemented orchestration, not live release acceptance. Run through the primary agent's existing credential session or a trusted release runner. Never put key values on command lines or in repository files. CI remains deferred by the owner; no new workflow trigger has been enabled.

## Inputs and identity

- `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_PRIVATE_KEY`: existing App Store Connect API identity.
- `APPLE_TEAM_ID`: registered team identifier.
- Match credentials (`MATCH_PASSWORD` and SSH access) for the private `git@github.com:0x63616c/folding-signing.git` repository. Signing must already be provisioned; archive uses readonly match and a temporary keychain, removed on exit.
- `FOLDING_WORKFLOW_RUN_URL`: durable run identity for the reservation.
- `FOLDING_COPYRIGHT`: actual operator/copyright owner, supplied before sealing release assets.
- `FOLDING_TESTFLIGHT_GROUPS`: explicit comma-separated internal group names.
- Review contact environment names are in `release-config.json`. Contact details are sent to Apple, never inserted into a public listing.

`reserve` requires a clean committed checkout on trusted main history and a private artifact repository. Globally serialize all distribution workflows using `folding-release`, with cancellation disabled. The central immutable draft-release reservation ledger also rejects concurrent revision writes. Allocation is above both registered apps' Apple maximum and every prior ledger reservation. The same commit/version/configuration key belongs to one release tag; retries reuse that record. A different binary needs a new reservation and build number, never an overwritten IPA.

Each release record revision is a new immutable GitHub release asset. Metadata, screenshots, IPA, archive and dSYMs are preserved in the private draft release. Readback verifies SHA-256 before reuse. Manifest revisions use optimistic compare-and-set by unique asset filename; a competing writer fails and reloads the latest remote record.

## Stages

```sh
bundle exec fastlane ios reserve tag:v1.0.0 version:1.0.0 environment:production
bundle exec fastlane ios release_preflight tag:v1.0.0 evidence:/absolute/path/evidence.json
bundle exec fastlane ios release_assets tag:v1.0.0
bundle exec fastlane ios archive tag:v1.0.0
bundle exec fastlane ios beta tag:v1.0.0
bundle exec fastlane ios release_preflight tag:v1.0.0 evidence:/absolute/path/evidence.json final:true
bundle exec fastlane ios submit tag:v1.0.0 evidence:/absolute/path/evidence.json
```

The initial preflight checks core CI, backend capability/version readback, public pages and recorded account prerequisites. Final preflight additionally requires screenshot/final-review runs, reviewed metadata/screenshots, product-readiness evidence, completed privacy/age-rating answers, exact processed Apple build and every artifact hash. The final review gate must complete before submission. Device checks remain explicitly deferred to F13, never represented as passing.

Evidence JSON contains `commit_sha`, `required_checks` entries (`name`, `run_url`, `conclusion`, `commit_sha`), `account_prerequisites_confirmed`; final evidence also contains `metadata_reviewed`, `screenshots_reviewed`, `app_privacy_complete`, `age_rating_complete`, `products` (`product_id`, `state`) and `final_review` (`state: approved`, `commit_sha`, `evidence_url`). Required check names are in `release-config.json`. Each run URL is read back through GitHub and must be completed/successful for the exact commit. Product/account/privacy evidence must be prepared from actual App Store Connect readback by the account integration; this helper does not pretend Boolean evidence discovers or creates those Apple settings.

Only production can submit. Staging can archive/TestFlight using isolated registered identifiers and backend origin. **Both** TestFlight environments use Apple's distribution values: CloudKit `Production`, App Attest `production`, APNs `production`. The backend's staging environment is independent of Apple's distribution signing environment.

`beta` never submits to App Review. It uploads the stored IPA once, then resolves only its exact version/build; repeat the lane to observe processing and distribute to the explicit internal groups. It never rebuilds. If an upload might have succeeded but no build is visible, it stops for Apple reconciliation rather than uploading blindly.

`submit` first associates metadata/screenshots with the exact processed build. Before the external submission attempt it persists an attempt marker. Resuming an ambiguous attempt only reads Apple. Success requires the selected build, `AFTER_APPROVAL`, a review-submission ID and `WAITING_FOR_REVIEW` or `IN_REVIEW`; only then does it publish the GitHub release record. Apple performs automatic public release after approval. Post-approval/live monitoring and physical-device acceptance remain F12/F13 work.

## Screenshots and localization

For unprivileged local capture:

```sh
bundle exec fastlane ios screenshots
```

This requires no Apple key or signing repository access. It creates and deletes its own Duo simulator; it never shuts down the owner's simulator. `screenshot-plan.json` pins the installed model/runtime, outer and inner display dimensions, deterministic fixture version/clock and all four native-view scenes. The separate simulator scheme includes real UI view sources with fixture-only composition and excludes live clients. Its fixture condition cannot be enabled in the device archive.

Fastlane snapshot captures each locale/display/scenario. Screen power is selected before capture; wrong dimensions fail rather than being relabeled. The Swift compositor preserves the whole native UI at its original aspect ratio on an opaque caption canvas. The required medium upload canvas is explicitly marked as composed from a Duo capture, not claimed to be a medium-device capture. Every raw/composed hash and exact tuple is in the capture manifest. App locale, notification locale and Apple storefront locale are separate mappings.

`metadata-source.json` is the content source; committed deliver `.txt` files must match it. Metadata is deliberately marked draft until final language review. `release_assets` seals its own current captures and metadata to the selected release identity. It does not silently reuse unrelated screenshots or replace a missing image with an older one. Independent visual review, real Fastlane capture execution, ASC upload-size acceptance and locale readback remain required before release acceptance.

## Interrupted operations

- Reload the latest remote manifest after a conflict. Never overwrite revision files or use `gh release upload --clobber`.
- If archive candidate hashes were recorded, `archive` resumes publishing the same local/remote files. If signing/building stopped before a candidate record, inspect the retained archive; the tool refuses an automatic rebuild under that reservation.
- If a partially uploaded artifact already exists, compare its downloaded bytes before treating it as complete. Missing local *and* remote candidates are an explicit recovery error.
- A failed attempt retains the last stable state and attempt marker. Read Apple before retrying upload/submission. No automatic cancellation of an Apple review, certificate revocation or new build allocation occurs.
- Keep signing recovery assets in 1Password/match and retain private release artifacts for the lifetime of the distributed version. Do not upload arbitrary workspaces or raw logs.

## Remaining integration acceptance

The lanes load and helpers compile, but the following are deliberately not claimed: real capture/render review; signed production archive/profile matching; TestFlight processing/distribution; App Store metadata/product/privacy readback; interruption/concurrency fault tests; live delivery against the current Apple asset API; final submission/readback; GitHub release workflow activation. Run those in the final validation/release phase. The actual app's production composition gate must also be removed by the app integration owner before an archive can succeed.
