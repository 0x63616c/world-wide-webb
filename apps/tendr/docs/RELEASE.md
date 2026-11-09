> Historical release notes from before the monorepo. Current commands and paths: [root release guide](../../../docs/RELEASE.md).

# Automatic TestFlight releases

[TestFlight workflow](../.github/workflows/testflight.yml) runs `bundle exec fastlane ios beta` on every push to `main`, including PR merges. It uses macOS 15 with Xcode 26.2 and Ruby 3.4, installs the locked gems, runs core tests, archives, uploads, waits for Apple processing, and assigns the build to **Owner Preview**. The checked-in Xcode project is used directly; CI does not need XcodeGen. A manual dispatch on `main` is available for recovery. Publishing another selected branch requires explicitly enabling `confirm_branch_release`; this allows a real CI release to validate signing fixes before merging.

Before this workflow, `.github/workflows/core.yml` only tested and built for the simulator. Merging did not invoke Fastlane. Earlier shipped-build commits recorded releases made on the release Mac.

## Required repository secrets

Add these under repository **Settings → Secrets and variables → Actions**. The workflow fails with named missing-secret errors until these six values are configured.

| Secret | Value / format |
| --- | --- |
| `ASC_KEY_ID` | App Store Connect API key ID, plain text. |
| `ASC_ISSUER_ID` | Issuer ID UUID from the same App Store Connect team API key. |
| `ASC_KEY_CONTENT` | Full raw contents of its `.p8` private key, including PEM header/footer and actual newlines. Do not base64 encode this value. Use an **App Manager** team key with access to this app and Certificates, Identifiers & Profiles so it can manage the CI profile, upload, and manage internal distribution. |
| `ASC_BETA_FEEDBACK_EMAIL` | Email address to receive beta feedback, plain text. |
| `BUILD_CERTIFICATE_BASE64` | Base64 of an exported **Apple Distribution** `.p12`, including its private key, for team `X9E4HG27NK`. Export the existing release identity from Keychain Access on the release Mac with a nonempty password. |
| `P12_PASSWORD` | The password used to encrypt that `.p12`, plain text. |

On macOS, `base64 -i release.p12 | pbcopy` produces the certificate value. Never commit the file or secret values. Replace the certificate secret before expiry. `BUILD_PROVISION_PROFILE_BASE64` is no longer read: the originally supplied Xcode-managed profile could not be used with manual archive signing.

The local lane uses Xcode's release-Mac keychain/profile setup and allows provisioning updates during export. There is no `Matchfile`, signing repository, or `match` lane. CI imports the existing distribution identity into an ephemeral keychain. Fastlane `get_provisioning_profile` (`sigh`) uses the same API key to fetch or create the dedicated **Tendr CI App Store** profile for the installed certificate. The lane requires this exact profile name, then selects the returned UUID for both archive and export. It does not create certificates, use Xcode-managed profiles, or require an Apple ID session. If the API key lacks Developer Portal access, provisioning fails before archiving. Profile creation and selection follow [Fastlane sigh](https://docs.fastlane.tools/actions/get_provisioning_profile/). The App Store Connect API key authenticates Fastlane and profile management; it does not contain the private code-signing key. The workflow generates its own temporary keychain password and cleans up signing files even after failure; GitHub also destroys the hosted runner afterward. This follows [GitHub's certificate import approach](https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications) and [Fastlane's explicit export profile mapping](https://docs.fastlane.tools/actions/build_app/#export-options).

## In-app purchases

The optional tips (Coffee $0.99, Croissant $2.99, Gift $4.99) are defined in `fastlane/Fastfile` (`TIPS`) and must match `Still/Features/Journal/TipJar.swift` and `Tendr.storekit`. [In-app purchases](../.github/workflows/iap.yml) runs `fastlane ios tip_iaps` (manually, or by pushing an `iap/*` tag). It creates or updates each consumable's name, description, price, availability and review screenshot (`fastlane/iap/tip-sheet-review.png`), and never submits. New in-app purchases go to review with the next app version.

## Verification and recovery

Run `ruby scripts/check-release.rb` for a secret-free check of the actual Fastfile's local/CI signing branches, dedicated profile selection, next build number, distribution settings, and failure gates. Run `actionlint .github/workflows/*.yml` for workflow and embedded shell validation. Core CI also runs the lane check on PRs. These checks do not prove that Apple accepts the supplied certificate/profile/key or that a build reached TestFlight.

The workflow serializes publishers because the lane allocates `latest_testflight_build_number + 1`. Do not publish manually while CI is releasing. GitHub keeps one running and one pending run per concurrency group; rapid merges can supersede a pending run, with their changes included in the later main build. No release-record commit is pushed back to `main`, avoiding a release loop.

After adding secrets, merge to `main` (or dispatch TestFlight on `main`) and check the **Test, upload, and distribute to Owner Preview** step for processing and group-assignment success, then verify availability in App Store Connect. If a run times out after upload, inspect App Store Connect before retrying: `distribute_existing` can finish assignment for an already processed build without rebuilding. The workflow's timeout is 90 minutes; Apple processing can exceed it. Source build 17 below is historical evidence, not a live CI release status.

# App Store review preparation

[App Store release workflow](../.github/workflows/release.yml) prepares the App Store version and **stops before Submit for Review**. Run it from the Actions tab (**Run workflow**), or push a tag such as `app-store/1.0.0-1`. It:

1. Calls the [screenshots workflow](../.github/workflows/screenshots.yml): `scripts/capture-screenshots.sh` boots a fresh iPhone 17 Pro Max simulator (1320×2868), overrides the status bar to 9:41 with full signal and battery, and runs `StillUITests/ScreenshotTests` against the `--demo --screenshots` fixture (`Still/ScreenshotFixture.swift`) in light and dark. `scripts/frame-screenshots.swift` then frames five light captures and the dark Home, with the device running off the bottom edge so the tab bar is cropped, in `fastlane/screenshots/en-US`. Artifacts: `app-store-screenshots` (the framed PNGs that get uploaded), `screenshots-overview` (all six side by side) and `screenshots-raw`.
2. Runs `bundle exec fastlane ios prepare_review`:
   - `metadata` uploads `fastlane/metadata` (listing, URLs, category, copyright, review contact and notes) and replaces the screenshots with `deliver`. It never uploads a binary or submits.
   - `ensure_free_pricing` sets the price to Free only if no price exists yet.
   - `select_build` attaches the newest processed, unexpired TestFlight build of `APP_VERSION`. Merge to `main` and let TestFlight processing finish first.
   - `review_status` prints what App Store Connect now holds and adds it to the job summary.

Choose **skip_screenshots** to upload only text changes. The workflow uses the same `ASC_*` secrets as TestFlight. Two optional secrets fill in the App Review contact: `ASC_REVIEW_PHONE` (Apple requires a phone number) and `ASC_REVIEW_EMAIL` (defaults to `review_information/email_address.txt`). Release notes are skipped for the first version.

These items still need App Store Connect by hand: **Age Rating**, **App Privacy** (expected answer: Data Not Collected), the review contact phone number unless `ASC_REVIEW_PHONE` is set, and **Submit for Review**. The PR screenshots check reruns capture and framing whenever the fixture, the screenshot test or the scripts change. Locally, run `scripts/capture-screenshots.sh` and then the two `swiftc`/render commands from the workflow before running `fastlane ios metadata`.

# Latest recorded uploaded build: Tendr 1.0.0 (17)

September 19, 2026: build 17 uploaded, processing completed, and App Store Connect confirmed distribution to the **Owner Preview** internal group. It adds custom dose dates, clearing a schedule, schedule-aware projections, one-row treatment summaries, whole-card medication navigation, the weight tile opening Progress, monotone weight interpolation, and the Apple Health last-sync time. See [build 17 notes](BUILD-17.md). Existing internal testers update without another invitation. Installation on the physical iPhone is not verified from here.

Note: builds 13 to 16 were uploaded from this Mac before this entry, so the next build number comes from `latest_testflight_build_number`, not from this file.

# Previous uploaded build: Tendr 1.0.0 (12)

September 11, 2026: build 12 uploaded successfully and Apple confirmed processing completed. Assignment to the existing **Owner Preview** internal group still needs direct verification; processing alone does not prove tester availability.

Future releases use the checked-in Fastlane lanes: `verify` runs the fast core suite, `ui` runs the full simulator flow suite when UI behavior changes, `beta` verifies then builds and uploads the next build before waiting and assigning it to Owner Preview, and `distribute_existing` assigns a processed build without rebuilding it. App Store Connect API-key values are supplied at runtime and never committed.

On the release Mac, the ignored `.env.tendr` file supplies `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_BETA_FEEDBACK_EMAIL`, and either `ASC_KEY_PATH` or `ASC_KEY_CONTENT`. The API key needs the App Manager role so Fastlane can assign builds to the internal group. Run `bundle exec fastlane --env tendr ios beta changelog:"Visible changes"`. Existing internal group members receive the new build without another invitation.

# Previous verified release: Tendr 1.0.0 (5)

September 10, 2026: build 5 uploaded successfully and verified Testing in the existing Owner Preview internal group. App name updated to Tendr: Dose & Weight Journal. See [build 5 notes](BUILD-5.md). Existing testers can update without another invitation. Physical build 5 installation is not verified.

# Release state

App: Tend: Dose & Weight Journal, Apple ID `6809098849`.
Bundle identifier: `com.calumwebb.still`.
Current TestFlight release: **1.0.0 (4)**, app source commit `e20c947`.

Build 4 uploaded successfully September 10, 2026 at 12:03 Pacific. App Store Connect completed processing and the existing **Owner Preview** internal group reports **Testing**, with one tester and builds 3 and 4 assigned. Build 4 has 90 days remaining. TestFlight release notes were submitted. This verifies availability to the existing group, not installation of build 4 on the physical iPhone.

The owner previously installed build 3 on September 7; this is an update, not a new invitation. Automatic distribution remains disabled. No App Store or external beta review was submitted.

Validation: 12 core tests and 8 UI tests passed. New Journal add/edit/cancel-delete/delete/relaunch regression was observed failing before implementation and passing afterward. Simulator: Tend QA Pro Max, iOS 26.2. Physical iOS 27 behavior is not covered by these tests. See [Build 4 changes and limits](BUILD-4.md).

Archive: `build/TendBuild4.xcarchive`. UI results: `Test-Still-2026.09.10_11-59-42--0700.xcresult`. Synthetic screenshots are in `docs/screenshots/build4-*.png`.

Build 1 predates the kilogram editor regression fix and must not be distributed. Builds 2 and 3 are superseded. The app remains local-first with no backend; the assistant is a coming-soon preview.
