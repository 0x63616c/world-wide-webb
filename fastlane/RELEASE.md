# Folding release operations

This is implemented orchestration, not live release acceptance. Run through the primary agent's existing credential session or a trusted release runner. Never put key values on command lines or in repository files. CI remains deferred by the owner; no new workflow trigger has been enabled.

## Inputs and identity

- `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_PRIVATE_KEY`: existing App Store Connect API identity.
- Team `X9E4HG27NK` is pinned in `release-config.json` from the portal. Optional `APPLE_TEAM_ID` must match it.
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

The initial preflight checks named local or CI evidence, backend capability/version readback, public pages and recorded account prerequisites. Final preflight additionally requires screenshot/final-review runs, reviewed metadata/screenshots, product-readiness evidence, completed privacy/age-rating answers, exact processed Apple build and every artifact hash. The final review gate must complete before submission. Device checks remain explicitly deferred to F13, never represented as passing.

Evidence JSON contains `commit_sha`, `required_checks` entries (`name`, `run_url`, `conclusion`, `commit_sha`), `account_prerequisites_confirmed`; final evidence also contains `metadata_reviewed`, `screenshots_reviewed`, `app_privacy_complete`, `age_rating_complete`, `products` (`product_id`, `state`) and `final_review` (`state: approved`, `commit_sha`, `evidence_url`). Required check names are in `release-config.json`. CI evidence is bound to an allowlisted workflow path and exact job name, read back through GitHub for the exact commit and current run attempt. Whole-run success alone is insufficient. Product/account/privacy evidence must be prepared from actual App Store Connect readback by the account integration; this helper does not pretend Boolean evidence discovers or creates those Apple settings.

Only production can submit. Staging can archive/TestFlight using isolated registered identifiers and backend origin. **Both** TestFlight environments use Apple's distribution values: CloudKit `Production`, App Attest `production`, APNs `production`. The backend's staging environment is independent of Apple's distribution signing environment.

A 0.x preview archive and distribution require the configured preview capabilities (currently `profiles.milestones`) and exact Worker/source commit readback. Preserve broader recorded shipping deferrals; this check does not claim full production acceptance.

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

The lanes load and helpers compile, but the following are deliberately not claimed: real capture/render review; signed production archive/profile matching; TestFlight processing/distribution; App Store metadata/product/privacy readback; interruption/concurrency fault tests; live delivery against the current Apple asset API; final submission/readback; GitHub release workflow activation. Run those in the final validation/release phase. The app now validates the full registered runtime configuration and refuses development storage in Release. Signed archive/entitlement and live account behavior still need final integration evidence.

Tip review assets are included in the sealed asset archive and have their own manifest/map hashes in the release record. The single native Tip jar PNG maps to all three consumables, remains outside the storefront image directory and is never captioned or replaced with a simulated Apple checkout. `tip_review_screenshots` captures just that reviewer scene without credentials; `setup_tip_review_assets [tag:v1.0.0]` explicitly associates verified images with Apple products and records association IDs when using a release tag. See [tip packaging](TIPS.md#reproducible-review-image-packaging). Final visual review remains required for the full matrix and this reviewer image.

## Local checks while CI is deferred

Run `bundle exec fastlane ios local_check name:contracts` (or `domain-storage`, `backend`, `simulator`, `localization`, `screenshots`) from a clean commit. The lane executes repository-defined commands, records exit status and output hashes, and rejects source changes during the run. Add its returned JSON entry to `required_checks`. Preserve the evidence JSON and its adjacent logs together. Local evidence is trusted operator evidence, not a GitHub attestation; hashing detects subsequent changes, not a dishonest operator. Logs must contain only unprivileged test output.

For `final-review`, use `kind: review`, `name: final-review`, the source commit, `conclusion: success`, `evidence_path` and `evidence_sha256`. The referenced JSON must identify `reviewer`, `state: approved`, the same `commit_sha`, and an empty `findings` array after fixes. Keep the existing `final_review` summary in the enclosing release evidence. Screenshot capture does not replace visual review. Future CI jobs must first be explicitly mapped in `CheckEvidence::CI_JOBS`.

`bundle exec ruby fastlane/tests/coding_regressions_test.rb` verifies release recovery, asset sealing and evidence/submission guards without Apple credentials.

## Signing recovery and tip submission

Signing preparation attempts are audited separately from archive attempts. A keychain/match failure can retry the same unbuilt reservation. Once `build_app` might have run, use `bundle exec fastlane ios recover_archive tag:v1.0.0 reason:"…"` under the same distribution lock. It verifies the old build is absent from Apple, reserves a strictly newer global build number, records actor/reason/replacement, and retires old local outputs. Sealed candidate archives are published/reconciled instead of rebuilt. An interrupted replacement reuses its durable ledger reservation.

Submission prepares one Apple review submission containing the exact app version and all three `inAppPurchaseVersions`, then reads back every item and its purchase ownership. Retry preparation reconciles existing draft items; unrelated or ambiguous drafts fail closed. The irreversible submit marker is saved before requesting review. A lost submission response is observed, never blindly repeated. Live Apple acceptance of these newer public review resources remains a shipping check.

## Tendr-style marketing frames

The frame renderer is adapted from `0x63616c/apps`'s RDesign `rframe` template:
tracked uppercase label, large headline, graphite light/dark background and a thin
frame/shadow around the complete native capture. It fits Duo proportions without
adding a Dynamic Island or cropping the source UI. Frame geometry is versioned in
`screenshot-frame.json`; all ten locales' headlines/labels live in
`metadata-source.json`. Both remain subject to final language/visual review.

`fastlane ios screenshots` captures Today/community in dark mode and
History/Settings in light mode. Each locale has eight ordered Duo images (outer
then inner for each scene, sharing Apple's ten-image gallery limit) and four
medium-canvas images. The latter preserve a Duo capture's aspect ratio and are
identified as composed canvases in the manifest. Fastlane's pinned image classifier
must recognise each actual output's intended upload slot. Manifest validation also
rejects changed copy, capture plan, frame geometry or renderer source.

For a quick **draft frame only**, without starting a simulator:

```sh
scripts/preview-storefront /absolute/path/to/raw.png build/frame-preview.png --scene today --display duo-outer --locale en-US
```

Use a raw capture matching the scene's appearance. This command never creates
release evidence; only capture from a clean, committed source through the release
lanes can do that. It refuses to overwrite an existing output.

After sealing/reviewing all release assets and completing final preflight, upload
the listing without requesting App Review:

```sh
bundle exec fastlane ios storefront tag:v1.0.0 evidence:/absolute/path/evidence.json
```

The lane uses the same guarded upload path as `submit`. It verifies the exact
selected build, localized version copy, screenshot gallery count/order, source
checksums, dimensions and Apple's `COMPLETE` processing state. A completed upload
is recorded before readback; resume the lane if Apple is still processing images.
It does not call the review-submission API. Final `submit` rechecks the storefront
before submitting. This does not enable CI or replace outstanding provider review.

Focused local checks:

```sh
bundle exec ruby fastlane/tests/screenshot_frames_test.rb
bundle exec ruby fastlane/tests/storefront_readback_test.rb
```
