# Verification log

## Core

`swift test` passes 12 tests after the journal compatibility change. The new compatibility test failed on the older minimal journal fixture before implementation, then passed after default decoding was added. It also rejects an unknown future schema version. This verifies decoding, not the UI recovery experience.

Covered: weight chronology and future filtering, future taken-dose rejection, local weekday scheduling across daylight saving, journal round-trip and historical medication snapshots, overdue resolution, explicit syringe scale conversion, half-life arithmetic, decimal entry validation, goal pace and check-in rating bounds.

## UI

The Discover walkthrough passed (one test, zero failures; `build/DiscoverQA.xcresult`) on a separate iPhone 17 Pro Max simulator. It exercises navigation, dose sheet presentation, Progress, Journal, Discover filtering and opening a recipe. Further persistence and regression tests are recorded below.

## Coverage limits and remaining release work

- Recovery after unreadable storage has not been exercised through the UI.
- One-shot notification delivery is verified; permission denial and weekly recurrence need additional device coverage.
- Dark and light Home have been visually inspected. Larger accessibility text still needs a complete walkthrough.
- Signing, archive and upload succeeded. Build 3 is assigned to Owner Preview and marked Testing. The account-holder tester subsequently changed to Invited, confirming the owner preview invitation. Physical-device installation has not been observed.

## Dose unit switching regression

The simulator test `testChangingDoseUnitsPreservesTheDose` reproduced two failures: entering 3 U-100 units and selecting mg or mL kept the literal number 3. The selector now converts through the dose's concentration and preserves its amount (3 units = 0.15 mg = 0.03 mL at 5 mg/mL). If required conversion information is absent, it clears the input instead of reinterpreting it.

Xcode 26.2's Swift 6.2.3 compiler crashed in IR generation with a direct method reference used as the binding setter. An explicit closure compiles successfully. The same UI regression test is retained to verify the behaviour.

Verification: targeted UI test passed with zero failures in `Test-Still-2026.09.05_20-26-19--0700.xcresult`; `swift test` also passed after the change.

## Kilogram editor regression

After selecting kilograms in Settings, reopening the synthetic 88.5 kg journal entry displayed 40.14 kg. The UI test reproduced this exact mismatch. Initialization was triggering the unit-change observer and converting the loaded value twice. Conversion now occurs only through the unit picker's user-driven setter; loading an entry preserves its recorded amount. Editable weight values omit grouping separators and retain up to eight decimal places.

Verification: the kilogram UI regression passed in `Test-Still-2026.09.05_20-32-11--0700.xcresult`.

## Persistence journeys

On the isolated QA simulator, `testWeightSavesWithKeyboardOpenAndSurvivesRelaunch` passed: save 200.3 lb with the keyboard open, terminate, relaunch, find the record and reopen the same value. `testDoseCanBeSavedThenChangedToSkippedAndPersisted` also passed: save 0.5 mg, reopen it, mark skipped without an amount, terminate and confirm the skipped record after relaunch. These run against a separate test journal, not the synthetic in-memory demo. The reset flag only targets that test journal when `--uitest` is also supplied.

## Actual notification delivery

`testReminderPreviewIsConditionalAndDeliversANotification` passes in `build/NotificationQA2.xcresult`: the test button is hidden while reminders are off; enabling reminders reveals it; iOS permission is granted; after leaving the app, SpringBoard displays the actual notification title. The captured system banner is `docs/screenshots/actual-notification.png`. This proves one-shot notification delivery and shared notification copy, not every weekly recurrence or permission-denial scenario. An initial automation attempt tapped the switch row rather than its nested toggle; the test was corrected to operate the actual switch.

## Final interaction checks

Six UI tests passed together in `build/FullJourneys.xcresult`. A seventh, `testHomeGraphsOpenDetailsAndCanBeClosed`, then verified both Home graphs open detail screens and close through Done. It first exposed the missing Done control on weight details; after adding it, the targeted test passed. Twelve core tests pass, including a new regression ensuring a new journal has no assumed dosing weekdays. Light Home was visually inspected on the QA Pro Max; the actual capture is `docs/screenshots/home-light.png`.
