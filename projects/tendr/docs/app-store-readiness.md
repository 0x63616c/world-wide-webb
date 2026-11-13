# App Store readiness plan

> **Status: Phases 1–4 done on 2026-10-09 (PT).**
> Decisions: **mg-only dose entry for 1.0** (option A for blocker 3). Privacy and support pages are live at <https://tendr.worldwidewebb.co/privacy/> and <https://tendr.worldwidewebb.co/support/> (source in `projects/tendr/site/`, published from WWW with `scripts/publish-site.sh`).
> Screenshots, listing and the `App Store release` workflow are in place ([RELEASE.md](RELEASE.md#app-store-review-preparation)). Next: Phase 5. Calum completes Age Rating, App Privacy and the review phone number in App Store Connect, then presses **Submit for Review**.

## Progress

- [x] **Blocker 1:** privacy and support pages (`site/`, GitHub Pages). The app links both from Settings → Privacy & About (`PrivacyView` in `JournalView.swift`). Still to do: add the URLs in App Store Connect.
- [x] **Blocker 2:** assistant preview hidden behind `FeatureFlags.assistantPreview = false` (Discover link, Privacy & About section). `AssistantPreview.swift` stays in the tree.
- [x] **Blocker 3:** mg-only for 1.0 behind `FeatureFlags.syringeUnits = false` (`StillApp.swift`). Hides the mg/mL/Units picker, the units→mg/mL readout, the Settings "Dose entry" sheet and the U-100 toggle in Treatment. Stored `syringeUnits` data still decodes; those entries open and display in mg, and the reading is kept while the mg amount is unchanged. The units UI tests were removed and can come back with the flag.
- [x] **Blocker 4:** card retitled **"Estimated level"**, rounded to 2 decimals, with a "not a measured level or medical advice" caption. The method notes and paper links stay. `testLivePrecisionIsAlwaysSevenDecimals` was replaced by `testEstimatedLevelIsRoundedAndLabelled`.
- [x] **Blocker 5:** the background-sync claim was removed. The footer now says Tendr checks Apple Health when you open it. No entitlement was added, because it needs a provisioning profile change. The unsupported observer registration was subsequently removed so it cannot overwrite a successful sync with “Background sync unavailable”. Tendr refreshes at launch, on foreground and on demand. Background delivery would require `com.apple.developer.healthkit.background-delivery`, an updated provisioning profile and device validation.
- [x] **Blocker 6:** demo data is now "Weekly medication", plain 0.5 mg doses, a simple half-life model, and no vials, concentration or syringe.
- [x] First-launch disclaimer (`MedicalDisclaimerGate` in `StillApp.swift`). It shows once and is stored in `@AppStorage`; it's skipped for `--demo` and `--uitest`.
- [x] "Still backup" → "Tendr backup" (`Tracking.swift`).
- [x] ~~Drop `NSHealthUpdateUsageDescription`~~ **Reverted:** App Store Connect rejects an upload without it (409 "Missing purpose string") because of the HealthKit entitlement, even though the app only reads. Keep it.
- [x] Source version/build resynced to 1.1.0 (29) in `project.yml`, `Still.xcodeproj` and `app.yml`. Duo native validation remains pending; see [DUO.md](DUO.md).
- [x] Reviewer notes (`fastlane/metadata/review_information/notes.txt`).
- [x] **Phase 2:** `--demo --screenshots` fixture (`Still/ScreenshotFixture.swift`), `StillUITests/ScreenshotTests`, `scripts/capture-screenshots.sh` (iPhone 17 Pro Max, 9:41 status bar, light and dark) and SwiftUI marketing frames (`scripts/frame-screenshots.swift`).
- [x] **Phase 3:** listing as code in `fastlane/metadata`, uploaded by `fastlane ios metadata`.
- [x] **Phase 4:** `.github/workflows/release.yml` → `fastlane ios prepare_review` (listing, screenshots, Free pricing, latest processed build). It stops before Submit.
- [ ] CSV/JSON export, a better icon.
- [ ] Phase 5: Age Rating, App Privacy, review phone number, Submit for Review.
- Screenshot note: the Treatment tab icon is a syringe and the Treatment screen has a Vials section, so the screenshots crop the tab bar and leave out Treatment. Home still shows the "Add vial" tile and Log Dose shows a "No vial" picker.
- Open question: the home screen still shows the vial card ("Add vial"), and vials store mg/mL concentration. That's an inventory feature, not a calculator, but consider hiding it for 1.0 if review pushes back.

Goal: get Tendr through App Store review the first time. That means a professional listing, automated screenshots, and a release pipeline that stops just before **Submit for Review**, so Calum presses the button himself.

## App facts

| | |
| --- | --- |
| Bundle ID | `com.calumwebb.still` |
| Team | `X9E4HG27NK` |
| App Store Connect app | `6809098849`, **Tendr: Dose & Weight Journal** |
| Version | 1.1.0, build 29 (source settings in `project.yml` and `Still.xcodeproj`) |
| Platform | iOS 17+, iPhone, portrait and landscape; adaptive tabs/sidebar ([Duo validation](DUO.md)) |
| Data storage | Local JSON store on the device (`Still/Store.swift`). No server and no account. |
| HealthKit | Reads body weight only (`Still/HealthKitWeightStore.swift`) |
| Notifications | Local reminders only |
| Privacy manifest | `Still/PrivacyInfo.xcprivacy` is present |
| Encryption | `ITSAppUsesNonExemptEncryption = NO` |
| Release pipeline | `fastlane ios beta` + `.github/workflows/testflight.yml` upload to TestFlight (Owner Preview) on every push to `main` ([RELEASE.md](RELEASE.md)) |

## Blockers (likely to cause a rejection)

### 1. No privacy policy or support URL ✅ pages live
Privacy: <https://tendr.worldwidewebb.co/privacy/> · Support: <https://tendr.worldwidewebb.co/support/> (contact `support@worldwidewebb.co`). WWW's `projects/tendr/site/` content publishes to Cloudflare; the app's Privacy & About links and `fastlane/metadata/en-US/*_url.txt` use the canonical host. App Store Connect updates use the normal metadata/release handler. Old installed builds retain their retired GitHub Pages links until updated.

A HealthKit app must link a privacy policy, both in App Store Connect and inside the app. A support URL is required for every app. Guidelines 5.1.1 and 5.1.3.

- **Plan:** host both pages on GitHub Pages. The assistant can write them. The privacy policy covers on-device storage only, read-only weight from Apple Health, no tracking, no data sent anywhere, and how to delete data.
- Link the privacy policy from Settings in the app as well.

### 2. "Coming soon" assistant screen
Reviewers reject placeholder or unfinished features under guideline 2.1 (app completeness).

- `Still/Features/Discover/AssistantPreview.swift`, the whole screen
- `Still/Features/Discover/DiscoverView.swift` ~67–72, the "A space to talk · Assistant · Coming soon" link
- `Still/Features/Journal/JournalView.swift` ~191, the "Assistant" settings section

**Plan:** hide all three for 1.0. Bring them back when the assistant is real.

### 3. Units → mg/mL converter (OPEN DECISION)
The dose editor turns syringe units (U-100) or mL plus a vial concentration into mg. To a reviewer this looks like a dosage calculator, which is a risk under guideline 1.4.2.

- `Still/Features/Journal/Editors.swift` ~63–70 does the conversion (`case "units"` / `case "mL"`)
- ~84 has the mg / mL / Units picker
- ~89 shows the "X mg · Y mL" readout
- ~311–330 is the preferred unit and U-100 syringe setting (`DosePreferencesEditor`)

**Options:**
- **A. mg only for 1.0.** Safest. Hide the mL/Units input and the syringe preference, then bring units back in a later update once the app is approved.
- **B. Keep units, but present them as a record.** The wording makes clear it records what was taken, not what to take (e.g. "You recorded 50 units ≈ 2.5 mg"), and a reviewer note explains this. Some risk remains.

**Decision needed from Calum.**

### 4. "Medication level" card overclaims
The home card is titled "Medication level" and shows an estimated mg value to about 7 decimal places. That precision implies a measured value, which is a risk under guideline 1.4.1.

- `Still/Features/Home/MedicationCard.swift` ~22 (title)
- `StillUITests/StillUITests.swift` ~76, `testLivePrecisionIsAlwaysSevenDecimals`, asserts `"0.0000000"`

**Plan:** retitle it **"Estimated level"** and round it to a sensible precision (e.g. 2 decimals). Update the UI test to match. Keep the existing method notes and paper links (MedicationCard ~79–86), which already say it is not a measured blood level.

### 5. Background Health sync is promised but not entitled
The Settings footer says "Tendr stays up to date in the background when Apple Health records a new weight" (`Still/Features/Journal/JournalView.swift` ~138). But `Still/Still.entitlements` only has `com.apple.developer.healthkit`, not `com.apple.developer.healthkit.background-delivery`.

**Plan:** add the background-delivery entitlement and confirm the observer query works, or change the wording to remove the claim.

### 6. Demo data looks like compounded semaglutide
`Store.demoJournal()` (`Still/Store.swift` ~181–200) uses "Semaglutide" at 0.5 mg from a 5 mg/mL vial with a U-100 syringe. In screenshots that reads as compounded GLP-1, which draws extra scrutiny.

**Plan:** the screenshot data uses neutral, plain-mg doses (generic medication name, no vial/syringe maths on screen). Keep brand and drug names out of the name, subtitle, keywords, and description.

## Nice-to-haves

- **First-launch disclaimer.** One screen saying Tendr is a personal journal, not medical advice, and to follow your clinician. Helps with 1.4.1.
- **CSV/JSON export.** Lets people take their data out, and gives reviewers a good impression.
- **Better icon.** A flattened version plus dark and tinted variants for iOS 18+, generated from `scripts/render-icon.swift`.
- **Wording fix.** "This file is not a valid Still backup" should say Tendr (`Still/Core/Tracking.swift` ~98).
- ~~**Drop the unneeded Health write usage string.**~~ Not possible: upload validation requires `NSHealthUpdateUsageDescription` for HealthKit apps.
- **Keep source versions aligned.** `project.yml` and `Still.xcodeproj` now agree on 1.1.0 (29), with `app.yml` at 1.1.0. CI allocates release build numbers from TestFlight.
- **Reviewer notes.** Explain that there is no login, that data stays on the device, what HealthKit is used for, and how to see sample data.

## Plan

### Phase 1: App fixes
- Blockers 1–6 above, plus the first-launch disclaimer.
- Update the UI tests (e.g. the seven-decimal test, and the hidden assistant entry points).

### Phase 2: Screenshot automation
- Add a `--screenshots` launch argument that loads a clean, neutral fixture (like `--demo`, without brand names or unit maths).
- An XCUITest captures 5–6 key screens (Today/Home, Journal, Progress/Goal, Treatment, medication detail, Settings) in **light and dark** mode.
- Use `xcrun simctl status_bar override` for a clean status bar (9:41, full battery and signal).
- Target the **iPhone 17 Pro Max** simulator, 6.9" display, **1320 × 2868**, which is the size App Store Connect requires.
- **Marketing frames:** a SwiftUI template in the repo puts a short caption above each screenshot on a branded background, rendered to PNG. Skip fastlane `frameit`, because it lags behind new devices and looks dated.

### Phase 3: Listing as code
- `fastlane/metadata/en-US/`: `name.txt`, `subtitle.txt`, `description.txt`, `keywords.txt`, `promotional_text.txt`, `privacy_url.txt`, `support_url.txt`, `marketing_url.txt` (optional), plus `fastlane/metadata/review_information/` (notes, contact).
- A new `fastlane ios metadata` lane uploads the listing and screenshots using `deliver` with `submit_for_review: false`, `skip_binary_upload: true`, and `force: true` (non-interactive).

### Phase 4: Release pipeline
- Keep the TestFlight-on-merge workflow as it is.
- Add a manually run **`release`** GitHub Actions workflow on macOS runners: generate screenshots → upload the listing and screenshots → attach the latest processed build to the 1.0.0 version. It **stops before Submit for Review**.

### Phase 5: Submit
- Calum checks the version page in App Store Connect and presses **Submit for Review**. The assistant then watches the review status and reports back.

## Proposed defaults (confirm when resuming)

- Privacy and support pages: **GitHub Pages** (live, see blocker 1)
- Price: **Free**
- Category: **Health & Fitness** (primary). Medical is possible but invites stricter review.
- Name: **Tendr: Dose & Weight Journal**

## Needs from Calum

1. ~~A privacy policy and support URL.~~ Done (GitHub Pages, see blocker 1).
2. The units decision for blocker 3 (option A or B).
3. Complete the **Age Rating** and **App Privacy** questionnaires in App Store Connect. Expected answer for App Privacy: **Data Not Collected**.
4. Confirm the App Store Connect API key used in CI (`ASC_KEY_ID`) has the **App Manager** role or higher. `deliver` needs it to edit metadata.
5. Press **Submit for Review**.

## Tools

- **fastlane:** `deliver` (listing and screenshots), `beta` (existing TestFlight lane)
- **XCUITest + `xcrun simctl`:** screenshot capture and status bar override
- **SwiftUI frame template:** captions and marketing frames, in the repo
- **`asc` CLI (optional):** [rorkai/app-store-connect-cli](https://github.com/rorkai/app-store-connect-cli) for quick App Store Connect checks from the terminal
- **GitHub Actions macOS runners:** the same setup as `testflight.yml`

## Next steps when resuming

1. Get the units decision (URL hosting is done).
2. Phase 1 app fixes on a branch, then a PR.
3. Phases 2–4 (screenshots, listing, release workflow), then a PR.
4. Run `release`, review it in App Store Connect, then Calum submits.
