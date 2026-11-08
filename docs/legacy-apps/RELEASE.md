## Automatic Tendr delivery

A main-branch change selected by `scripts/affected --intent ship` now runs the whole Tendr delivery in the TestFlight workflow: shared/core tests, next App Store version planning, signed binary upload and processing, ordinary and Duo fixture captures, listing preparation, uploaded-file verification, and joint app/purchase submission with release after approval. The manual TestFlight dispatch follows the same pipeline for Tendr on main; explicitly confirmed non-main dispatches remain TestFlight-only. Publication waits for successful CI on the exact source revision in a Linux prerequisite job, leaving Mac capacity available for those checks; only then can the Mac publisher start. Tendr listing-only and screenshot configuration changes also start the pipeline. Other apps remain TestFlight-only.

When the configured version is already live, the planner increments its patch version automatically for the binary and listing. An editable failed preparation is reused. A pipeline-owned **Waiting for Review** submission is replaced by a newer eligible main merge: reuse its version, process the replacement binary and capture its screenshots first, then recheck Apple and withdraw the whole waiting app/purchase bundle. All withdrawn purchase versions must be present in the replacement inventory before submission. The same source never withdraws itself; untracked builds, unrelated review items, reviewed items, unknown states, actual **In Review**, and pending releases are preserved. Changes during review coalesce into one deferred update from current main after public availability. A source check before planning, withdrawal and final submission stops stale publishers when newer app, declared dependency, listing or screenshot-configuration changes have landed; tooling and documentation alone do not supersede a release.

The hourly availability workflow resumes durable deferred changes when the app is waiting, editable after withdrawal, or publicly available. It does not claim a waiting app is public. Every resumed publisher rechecks Apple under the same per-app lock. Failed replacement builds or screenshot captures leave the waiting submission intact. Apple has no conditional cancellation API: the workflow reads the submission immediately before its single cancellation request, but Apple can start review between that read and accepting the request. Withdrawing a waiting bundle restarts its place in the review queue. See [Apple’s withdrawal rules](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/remove-a-submission-from-review). The exact uploaded version, build and source SHA are recorded in the run's release-evidence artifact together with the staged screenshots and raw Duo evidence.

Screenshot builds take their marketing version and build number from that processed-build manifest, so an automatically incremented release also has the correct Settings footer. Manual preparation passes its resolved version and build to both screenshot helpers. A mismatched app/source or conflicting override stops capture.

Duo capture and release export are required, including on relevant PRs. When simctl cannot fold the device, CI uses a macOS XCTest controller to select the disposable simulator and operate Device Hub’s Open/Closed controls. It captures only the active display and verifies native layouts, retained state, dimensions and nonblank pixels. The older successful capture artifact contained a blank inner framebuffer; it is not upload evidence. Before submission, the pipeline checks every staged image against Apple's processed file checksum and verifies that Duo images are in `APP_IPHONE_DUO`. Capturing an artifact alone no longer counts as App Store delivery. Signing assets are cleaned up even when later steps fail. Manual preparation/submission and automatic delivery share the app's release lock.

An automatic release can recover once from an identified native-controller acknowledgement timeout by recreating the disposable Duo and rerunning the complete capture suite. Other test failures and cancellation are not retried; a second native timeout still fails delivery. Controller logs and failed results/partial fixture captures are retained under the raw artifact's `diagnostics/run.*` directories, including when the fresh attempt succeeds. PR captures retain their single-attempt failure signal.

Apple review may take longer than an Actions job. **App Store availability** checks hourly and on manual dispatch: it reports a pending review honestly, fails on rejection or a manual-release hold, and requires both Apple's listing API and working public product pages in the US and UK before reporting availability. A lookup result with a 404 product page fails. GitHub's run failure notifications are the alert channel. No approval or public availability is claimed by the upload/submission job.

To repair the missing Duo screenshots in approved 1.1.0, run the pipeline once from main. Apple requires a new version to change approved screenshots; the planner creates 1.1.1 (or the next available version) and captures all screenshots from the new binary's source revision. The existing approved version is preserved.

# Releases

All release commands run at the repository root, with `bundle install` first. The root `fastlane/Fastfile` reads `apps/<app>/app.yml`: project, scheme, unchanged bundle ID, profile name, version, TestFlight flag/group and consumable tips.

```sh
ruby scripts/check-release.rb             # no Apple access
bundle exec fastlane ios verify app:tendr
bundle exec fastlane ios beta app:tendr
bundle exec fastlane ios distribute_existing app:tendr build:18
bundle exec fastlane ios prepare_review app:tendr build:29
```

`beta` tests, selects the next build number, archives, uploads, waits for processing and distributes to the configured internal group. Concurrent publishers for one app can race; do not run a local upload alongside its Actions job. Automatic main-branch delivery is enabled for Tendr. Verify an app’s App Store record, profiles and internal group before enabling automatic delivery. The flag controls automatic and manually dispatched Actions delivery; an explicit local `beta app:...` command remains available.

`scripts/affected <base> --intent verify|ship` is the shared change-impact resolver used by CI and per-app PR workflows. The Duo screenshots workflow keeps its own `paths:` filter (Tendr, RDesign and the Duo scripts) so unrelated shared tooling edits do not start the device-specific capture. It runs on GitHub-hosted `xcode-27` with Xcode 27.1 and its iOS 27.1 Duo runtime. Capture and release-export failures fail both PR and manual runs. Install its Python dependency with `python3 -m pip install -r scripts/requirements.txt`. Each `apps/<app>/app.yml` declares `uses: [PackageName]` (directories under `packages/`) and optional repo-relative `paths: [glob]`; its own app folder is always included. Tendr uses RDesign. Templates declare RDesign for newly scaffolded apps. Unknown packages and invalid lists are errors.

`verify` selects apps whose own files, extra paths or declared packages changed. Fastfile, Appfile, Gemfile, scripts and workflow/action tooling changes verify every app. RDesign and template jobs use the same result; tooling verifies both, and RDesign changes also verify the scaffold. Template-only edits run the template job. CI runs on PRs, main pushes and manual dispatch, so a branch push does not duplicate PR CI.

`ship` selects only changed apps with `testflight: true`, based on their own files, extra paths and declared packages. Tooling-only changes ship nothing. Changes limited to the `uses`/`paths` declarations in `app.yml` also ship nothing; other app configuration changes retain normal app impact. Docs (including `*.md`), app-local `fastlane/` metadata and `screenshots.json` are excluded from impact; listing and site changes do not trigger uploads unless an app explicitly declares an extra path. A RDesign code change ships Tendr only.

`--head <commit>` evaluates impact against that committed tree, including its app configurations and packages, without changing the checkout. The release source check uses it to compare the running source with freshly fetched main. The base is the supplied commit when available. Empty, zero or unknown bases use `git merge-base HEAD origin/main`, so a branch's first push compares its actual changes. Main without a usable remote base uses `HEAD~1`; without either history the resolver fails with a fetch instruction, never an all-app fallback. Workflows fetch full history.

`.github/workflows/testflight.yml` uses `--intent ship` for main pushes. Manual dispatch retains explicit app selection and requires `confirm_branch_release` for a non-main branch. Every execution job has a timeout; macOS jobs run on GitHub-hosted `xcode-27` with `DEVELOPER_DIR` explicitly set to `/Applications/Xcode_27.1.app/Contents/Developer` (see root README). App toolchain overrides must use hosted paths; legacy repository runner/toolchain variables are ignored. `scripts/setup-mac-runner.sh` is optional legacy setup, not required for CI. Release and TestFlight serialization is unchanged.

Actions requires `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_CONTENT`, `ASC_BETA_FEEDBACK_EMAIL`, `BUILD_CERTIFICATE_BASE64` (Apple Distribution certificate and private key exported as P12), and `P12_PASSWORD`. Store them as GitHub secrets. The workflow imports a temporary keychain; `sigh` creates/reuses the configured profiles. Temporary signing edits are restored, and the workflow removes its profiles/keychain afterward. Never commit secrets or signing files.

Locally, provide the ASC variables above and either `ASC_KEY_PATH` or `ASC_KEY_CONTENT`. Xcode automatic signing is preserved outside Actions. For a single-target app, `R_PROFILE_UUID` opts into manual local signing.

The manual **App Store release** workflow requires an app slug and exact processed TestFlight `build` number. `version` defaults to `app.yml`. Tags must encode both: `app-store/tendr/1.1.0-29` (legacy `app-store/1.1.0-29` means Tendr). Arbitrary tag suffixes are rejected. Run it at the same source revision used for the pinned binary so the screenshots represent that build; the build number lookup does not verify source provenance.

The workflow calls `prepare_review`: validates the exact build is processed and unexpired and the App Store version is editable, then uploads app-local metadata/screenshots, sets free pricing where needed and attaches that build. It never chooses a newer build automatically and stops before Submit for Review. Preparation refuses versions already waiting/in review and never withdraws a submission. Optional `ASC_REVIEW_PHONE` and `ASC_REVIEW_EMAIL` supply review contact details. Apps without capture configuration should use `skip_screenshots`, which preserves the existing screenshots for all display sizes. Metadata remains app-local.

For Tendr, the release screenshot job generates the project, captures and frames the ordinary iPhone screenshots, then captures Duo light/dark on a Duo-capable Xcode selected by `scripts/select-duo-xcode.py`. `DUO_DEVELOPER_DIR` optionally overrides its preferred path. The app's `duo_screenshot_test` enables Duo capture; `screenshots.json` supplies `duo_shots` (up to five scenes, captured on both displays). `scripts/stage-duo-screenshots.py` exports ten or fewer native, unframed, opaque RGB screenshots into the same `fastlane/screenshots/en-US` artifact as the ordinary frames. Fastlane 2.241.1+ recognizes both resolutions as the single `APP_IPHONE_DUO` gallery. Fallback/default-screen captures, incorrect dimensions, transparent pixels and blank displays fail preparation before any upload. Raw captures and their capability notes are retained as a separate artifact. Inspect actual captures before submission; automated checks cannot prove visual correctness or that every named display is showing the intended scene.

The separate **Submit for review** workflow requires the exact `build` number and calls `submit_with_iap`. Its default is a read-only dry run. The lane inventories all IAPs and subscriptions, requires their pending versions to be ready, and adds them (and subscription group versions when needed) to the same submission as the app. Already approved products need no new submission. It uses `deliver(submit_for_review: true)` with a scoped replacement for deliver's app-only submission step, retaining its explicit build selection and compliance checks. When a rejected submission is missing products, Apple forbids adding them there: the lane removes only its matching rejected items, waits for that submission to complete, then assembles a new draft with all items. It preserves the old review history. If all items are already attached it resolves those matching rejected items in place. It refuses unrelated items and active reviews; it never cancels a submission.

```sh
bundle exec fastlane ios submit_with_iap app:tendr version:1.1.0 build:2 dry_run:true
bundle exec fastlane ios submit_with_iap app:tendr version:1.1.0 build:2
ruby scripts/test-review-products.rb
```

This lane never creates products or writes prices, metadata, or screenshots. If a product is incomplete it stops with its state; prepare that product before retrying, obtaining approval for new products or price changes. The existing `tip_iaps` preparation lane **does** create products and replace price schedules, so do not invoke it just to submit. The read-only **Review status** workflow also reports the IAP inventory, localization locales, price schedule presence, screenshot delivery state and purchase-version states. API credentials stay in Actions secrets. Neither review workflow is triggered by an ordinary TestFlight upload.

```sh
scripts/capture-screenshots.sh tendr
scripts/frame-screenshots.sh tendr
bundle exec fastlane ios metadata app:tendr
bundle exec fastlane ios review_status app:tendr
```

Tendr’s optional tips are configured in `apps/tendr/app.yml`, `Tendr.storekit`, and `Still/Features/Journal/Tips.swift`. Keep product IDs aligned. `tip_iaps app:tendr` updates consumable records and review screenshots without submitting. RDesign’s `RTipJar` unlocks no features.

After an uncertain upload, check App Store Connect before retrying. Confirm processing, the correct internal group and tester availability. For an already processed build use `distribute_existing`, which uploads no new binary. Native builds, Apple signing, App Store Connect calls and live Actions execution cannot be validated by Linux tests.

Historical Tendr release evidence remains in [apps/tendr/docs/RELEASE.md](../apps/tendr/docs/RELEASE.md); its old root paths are historical. App-local legacy release scripts are retained only for recovery, not automatic delivery. The root lane is the current release authority.

## Retiring discontinued apps

Manually dispatch **Retire discontinued apps in ASC** (`asc-retire.yml`) on Ubuntu. It uses the existing `ASC_KEY_ID`, `ASC_ISSUER_ID` and `ASC_KEY_CONTENT` secrets; the key content accepts raw PEM or base64 PEM. No repository variables or additional secrets are needed.

The hard-coded scope is `com.calumwebb.blockr`, `com.calumwebb.festr`, `com.calum.shots` and their dot-suffixed children. Tendr and every other bundle ID are refused. The default `report` mode prints app names/Apple IDs, versions/states, build and unexpired counts, beta groups/tester counts, registered identifiers/platforms and profile names/IDs/states to stdout and the Actions summary. Tester personal data is never printed.

`retire` first reports, then expires unexpired TestFlight builds and deletes the retired identifiers' provisioning profiles. It never touches certificates or removes App Store app records. Remove app records separately in the ASC web UI when appropriate, then run `delete-ids` to report and attempt identifier deletion, children first. Apple may still reject attached IDs; each API error is reported, processing continues and any failure makes the job fail. Re-run after resolving the attachment. Discovery errors prevent all mutations. These modes do not withdraw an App Store listing automatically.

The next normal Site publication removes discontinued pages from gh-pages: publication replaces the tree and `site/.retain` contains no retired entries. No manual prune is required.

Tendr's future versions automatically go live after App Review approval. `scripts/release-policy.rb` applies `AFTER_APPROVAL` during listing preparation and immediately before submission (including the legacy submission script). Dry runs do not change the policy. Other apps retain their existing release preference. The main-branch pipeline described above builds and submits Tendr automatically; the release-policy helper controls what happens after Apple approves that submission.
