# Releases

All release commands run at the repository root, with `bundle install` first. The root `fastlane/Fastfile` reads `apps/<app>/app.yml`: project, scheme, unchanged bundle ID, profile name, version, TestFlight flag/group and consumable tips. Blockr lists its extensions’ separate signing profiles under `signed_targets`.

```sh
ruby scripts/check-release.rb             # no Apple access
bundle exec fastlane ios verify app:tendr
bundle exec fastlane ios beta app:tendr
bundle exec fastlane ios distribute_existing app:tendr build:18
bundle exec fastlane ios prepare_review app:tendr build:29
```

`beta` tests, selects the next build number, archives, uploads, waits for processing and distributes to the configured internal group. Concurrent publishers for one app can race; do not run a local upload alongside its Actions job. Automatic main-branch delivery is enabled for Tendr and Blockr. Verify an app’s App Store record, profiles and internal group before enabling automatic delivery. The flag controls automatic and manually dispatched Actions delivery; an explicit local `beta app:...` command remains available.

`scripts/affected <base> --intent verify|ship` is the shared change-impact resolver used by CI and per-app PR workflows. The Duo screenshots workflow keeps its own `paths:` filter (Tendr, RDesign and the Duo scripts) because the Duo capture needs Xcode 27.1, which the self-hosted runner does not have yet, so shared tooling edits do not start it. Install its Python dependency with `python3 -m pip install -r scripts/requirements.txt`. Each `apps/<app>/app.yml` declares `uses: [PackageName]` (directories under `packages/`) and optional repo-relative `paths: [glob]`; its own app folder is always included. Tendr uses RDesign; Blockr uses no shared packages. Templates declare RDesign for newly scaffolded apps. Unknown packages and invalid lists are errors.

`verify` selects apps whose own files, extra paths or declared packages changed. Fastfile, Appfile, Gemfile, scripts and workflow/action tooling changes verify every app. RDesign and template jobs use the same result; tooling verifies both, and RDesign changes also verify the scaffold. Template-only edits run the template job. CI runs on PRs, main pushes and manual dispatch, so a branch push does not duplicate PR CI.

`ship` selects only changed apps with `testflight: true`, based on their own files, extra paths and declared packages. Tooling-only changes ship nothing. Changes limited to the `uses`/`paths` declarations in `app.yml` also ship nothing; other app configuration changes retain normal app impact. Docs (including `*.md`), app-local `fastlane/` metadata and `screenshots.json` are excluded from impact; listing and site changes do not trigger uploads unless an app explicitly declares an extra path. A RDesign code change ships Tendr only; a Blockr code change ships Blockr only.

The base is the supplied commit when available. Empty, zero or unknown bases use `git merge-base HEAD origin/main`, so a branch's first push compares its actual changes. Main without a usable remote base uses `HEAD~1`; without either history the resolver fails with a fetch instruction, never an all-app fallback. Workflows fetch full history.

`.github/workflows/testflight.yml` uses `--intent ship` for main pushes. Manual dispatch retains explicit app selection and requires `confirm_branch_release` for a non-main branch. Every execution job has a timeout; macOS jobs respect `MACOS_RUNNER` and `DEVELOPER_DIR` (see root README).

Actions requires `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_CONTENT`, `ASC_BETA_FEEDBACK_EMAIL`, `BUILD_CERTIFICATE_BASE64` (Apple Distribution certificate and private key exported as P12), and `P12_PASSWORD`. Store them as GitHub secrets. The workflow imports a temporary keychain; `sigh` creates/reuses the configured profiles. Blockr archives use target-specific profiles for the app and its extensions. Temporary signing edits are restored, and the workflow removes its profiles/keychain afterward. Never commit secrets or signing files.

Locally, provide the ASC variables above and either `ASC_KEY_PATH` or `ASC_KEY_CONTENT`. Xcode automatic signing is preserved outside Actions. For a single-target app, `R_PROFILE_UUID` opts into manual local signing. Blockr uses local Xcode signing; its target-specific CI profiles are configured automatically only in Actions.

The manual **App Store release** workflow requires an app slug and exact processed TestFlight `build` number. `version` defaults to `app.yml`. Tags must encode both: `app-store/tendr/1.1.0-29` (legacy `app-store/1.1.0-29` means Tendr). Arbitrary tag suffixes are rejected. Run it at the same source revision used for the pinned binary so the screenshots represent that build; the build number lookup does not verify source provenance.

The workflow calls `prepare_review`: validates the exact build is processed and unexpired and the App Store version is editable, then uploads app-local metadata/screenshots, sets free pricing where needed and attaches that build. It never chooses a newer build automatically and stops before Submit for Review. Preparation refuses versions already waiting/in review and never withdraws a submission. Optional `ASC_REVIEW_PHONE` and `ASC_REVIEW_EMAIL` supply review contact details. Apps without capture configuration should use `skip_screenshots`, which preserves the existing screenshots for all display sizes. Metadata remains app-local.

For Tendr, the release screenshot job generates the project, captures and frames the ordinary iPhone screenshots, then captures Duo light/dark on a Duo-capable Xcode selected by `scripts/select-duo-xcode.py`. `DUO_DEVELOPER_DIR` optionally overrides its preferred path. The app's `duo_screenshot_test` enables Duo capture; `screenshots.json` supplies `duo_shots` (up to five scenes, captured on both displays). `scripts/stage-duo-screenshots.py` exports ten or fewer native, unframed, opaque RGB screenshots into the same `fastlane/screenshots/en-US` artifact as the ordinary frames. Fastlane 2.241.1+ recognizes both resolutions as the single `APP_IPHONE_DUO` gallery. Fallback/default-screen captures, incorrect dimensions, transparent pixels and blank displays fail preparation before any upload. Raw captures and their capability notes are retained as a separate artifact. Inspect actual captures before submission; automated checks cannot prove visual correctness or that every named display is showing the intended scene.

The separate **Submit for review** workflow also requires the exact `build` number and uses the same lookup; it cannot silently replace it with the newest upload. Its default is a read-only dry run. `cancel_waiting` remains an explicit opt-in and should stay false for a pending submission you intend to preserve. Neither this workflow nor release preparation is triggered by an ordinary TestFlight upload. Screenshot changes to a version waiting for review require withdrawal and resubmission, so prepare the next update without disturbing the pending version.

```sh
scripts/capture-screenshots.sh tendr
scripts/frame-screenshots.sh tendr
bundle exec fastlane ios metadata app:tendr
bundle exec fastlane ios review_status app:tendr
```

Tendr’s optional tips are configured in `apps/tendr/app.yml`, `Tendr.storekit`, and `Still/Features/Journal/Tips.swift`. Keep product IDs aligned. `tip_iaps app:tendr` updates consumable records and review screenshots without submitting. RDesign’s `RTipJar` unlocks no features.

After an uncertain upload, check App Store Connect before retrying. Confirm processing, the correct internal group and tester availability. For an already processed build use `distribute_existing`, which uploads no new binary. Native builds, Apple signing, App Store Connect calls and live Actions execution cannot be validated by Linux tests.

Historical Tendr release evidence remains in [apps/tendr/docs/RELEASE.md](../apps/tendr/docs/RELEASE.md); its old root paths are historical. App-local legacy release scripts are retained only for recovery, not automatic delivery. The root lane is the current release authority.
