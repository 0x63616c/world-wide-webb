# Releases

All release commands run at the repository root, with `bundle install` first. The root `fastlane/Fastfile` reads `apps/<app>/app.yml`: project, scheme, unchanged bundle ID, profile name, version, TestFlight flag/group and consumable tips. Blockr lists its extensions’ separate signing profiles under `signed_targets`.

```sh
ruby scripts/check-release.rb             # no Apple access
bundle exec fastlane ios verify app:tendr
bundle exec fastlane ios beta app:tendr
bundle exec fastlane ios distribute_existing app:tendr build:18
bundle exec fastlane ios prepare_review app:tendr
```

`beta` tests, selects the next build number, archives, uploads, waits for processing and distributes to the configured internal group. Concurrent publishers for one app can race; do not run a local upload alongside its Actions job. Automatic main-branch delivery is enabled for Tendr and Blockr. Verify an app’s App Store record, profiles and internal group before enabling automatic delivery. The flag controls automatic and manually dispatched Actions delivery; an explicit local `beta app:...` command remains available.

`scripts/affected <base> --intent verify|ship` is the shared change-impact resolver used by CI and per-app PR workflows. The Duo screenshots workflow keeps its own `paths:` filter (Tendr, RDesign and the Duo scripts) so unrelated shared tooling edits do not start the device-specific capture. It runs on GitHub-hosted `xcode-27` with Xcode 27.1 and its iOS 27.1 Duo runtime. Duo UI tests are not passing yet (APP-36), so capture failures remain non-blocking on PRs; manual dispatch failures still fail the job. Install its Python dependency with `python3 -m pip install -r scripts/requirements.txt`. Each `apps/<app>/app.yml` declares `uses: [PackageName]` (directories under `packages/`) and optional repo-relative `paths: [glob]`; its own app folder is always included. Tendr uses RDesign; Blockr uses no shared packages. Templates declare RDesign for newly scaffolded apps. Unknown packages and invalid lists are errors.

`verify` selects apps whose own files, extra paths or declared packages changed. Fastfile, Appfile, Gemfile, scripts and workflow/action tooling changes verify every app. RDesign and template jobs use the same result; tooling verifies both, and RDesign changes also verify the scaffold. Template-only edits run the template job. CI runs on PRs, main pushes and manual dispatch, so a branch push does not duplicate PR CI.

`ship` selects only changed apps with `testflight: true`, based on their own files, extra paths and declared packages. Tooling-only changes ship nothing. Changes limited to the `uses`/`paths` declarations in `app.yml` also ship nothing; other app configuration changes retain normal app impact. Docs (including `*.md`), app-local `fastlane/` metadata and `screenshots.json` are excluded from impact; listing and site changes do not trigger uploads unless an app explicitly declares an extra path. A RDesign code change ships Tendr only; a Blockr code change ships Blockr only.

The base is the supplied commit when available. Empty, zero or unknown bases use `git merge-base HEAD origin/main`, so a branch's first push compares its actual changes. Main without a usable remote base uses `HEAD~1`; without either history the resolver fails with a fetch instruction, never an all-app fallback. Workflows fetch full history.

`.github/workflows/testflight.yml` uses `--intent ship` for main pushes. Manual dispatch retains explicit app selection and requires `confirm_branch_release` for a non-main branch. Every execution job has a timeout; macOS jobs run on GitHub-hosted `xcode-27` with `DEVELOPER_DIR` explicitly set to `/Applications/Xcode_27.1.app/Contents/Developer` (see root README). App toolchain overrides must use hosted paths; legacy repository runner/toolchain variables are ignored. `scripts/setup-mac-runner.sh` is optional legacy setup, not required for CI. Release and TestFlight serialization is unchanged.

Actions requires `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_CONTENT`, `ASC_BETA_FEEDBACK_EMAIL`, `BUILD_CERTIFICATE_BASE64` (Apple Distribution certificate and private key exported as P12), and `P12_PASSWORD`. Store them as GitHub secrets. The workflow imports a temporary keychain; `sigh` creates/reuses the configured profiles. Blockr archives use target-specific profiles for the app and its extensions. Temporary signing edits are restored, and the workflow removes its profiles/keychain afterward. Never commit secrets or signing files.

Locally, provide the ASC variables above and either `ASC_KEY_PATH` or `ASC_KEY_CONTENT`. Xcode automatic signing is preserved outside Actions. For a single-target app, `R_PROFILE_UUID` opts into manual local signing. Blockr uses local Xcode signing; its target-specific CI profiles are configured automatically only in Actions.

The manual Release workflow accepts an app slug and calls `prepare_review`: uploads app-local metadata/screenshots, sets free pricing where needed and attaches a processed build. It stops before Submit for Review. Optional `ASC_REVIEW_PHONE` and `ASC_REVIEW_EMAIL` supply review contact details. Tendr has the shared capture/frame configuration. Apps without capture configuration should use `skip_screenshots`. Metadata remains app-local.

```sh
scripts/capture-screenshots.sh tendr
scripts/frame-screenshots.sh tendr
bundle exec fastlane ios metadata app:tendr
bundle exec fastlane ios review_status app:tendr
```

Tendr’s optional tips are configured in `apps/tendr/app.yml`, `Tendr.storekit`, and `Still/Features/Journal/Tips.swift`. Keep product IDs aligned. `tip_iaps app:tendr` updates consumable records and review screenshots without submitting. RDesign’s `RTipJar` unlocks no features.

After an uncertain upload, check App Store Connect before retrying. Confirm processing, the correct internal group and tester availability. For an already processed build use `distribute_existing`, which uploads no new binary. Native builds, Apple signing, App Store Connect calls and live Actions execution cannot be validated by Linux tests.

Historical Tendr release evidence remains in [apps/tendr/docs/RELEASE.md](../apps/tendr/docs/RELEASE.md); its old root paths are historical. App-local legacy release scripts are retained only for recovery, not automatic delivery. The root lane is the current release authority.
