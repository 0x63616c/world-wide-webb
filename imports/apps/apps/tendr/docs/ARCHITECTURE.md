# Tend architecture

## Shape

One native SwiftUI app, one Foundation-only core, no third-party runtime dependencies. Group screens by user task. Keep a single application store while the dataset and app remain small. Do not introduce a package or view model for every screen.

- `Still/Core`: records, validation, units, schedule calculations, weight trends and medication estimates. No SwiftUI, notifications or networking. Calculations accept a date so tests and previews can control time.
- `Still/Features/Home`: daily overview and quick entry points.
- `Still/Features/Treatment`: medication, vials, schedule and reminder presentation.
- `Still/Features/Progress`: goals and analytics presentation.
- `Still/Features/Journal`: record entry, editing and history.
- `Still/Features/Discover`: editorial content and the future assistant preview.
- `Still/Store.swift`: app state and coordinating persisted changes. Screens submit changes; they must not write files or schedule notifications directly.
- `Tests`: core behaviour through public interfaces.
- `StillUITests`: real user journeys through the running app.

The current feature folders are a first organization pass. Root navigation and shared editors still contain multiple screens; move those as their flows settle rather than disguising existing coupling with empty wrappers.

## Invariants

Persist before publishing a successful edit. A failed load must never permit an empty journal to overwrite the existing file. Historical doses retain their medication, concentration and syringe scale. Planned or skipped doses do not consume vial inventory or contribute to actual medication estimates. Future weights do not contribute to observed progress. Intended schedule time and actual administration time are different values.

Validation belongs in the core and is enforced again at the write interface, even when the UI disables Save. Date-sensitive calculations receive `now`; charts and live counters share those same calculations. Display formatting must not become the format used for editable numeric values.

Injection sides are optional on dose records: missing or null `side` decodes as unknown. The next side is the opposite of the latest known side by dose date; without one, it uses the journal's `injectionStartSide` preference (Right when absent). Editing an unknown dose leaves it unknown unless a side is chosen. Both fields are additive to version 1 of the local JSON format, so existing journals and device backups need no rewrite. Settings use the same atomic `Store.commit` path as doses. There is no separate export/import format, SwiftData store or CloudKit sync.

## iCloud sync assessment (2026-11-04)

CloudKit is technically available in TestFlight, but [Apple's review guideline 5.1.3(ii)](https://developer.apple.com/app-store/review/guidelines/#health-and-health-research) prohibits storing personal health information in iCloud. Tendr's medication, dose, note and weight records appear to fall within that restriction; obtain clarification from App Review before designing a journal upload. A private database, user consent or encryption should not be assumed to create an exception. Normal device backup is a separate mechanism from app-managed CloudKit sync.

[TestFlight supports CloudKit using its production environment](https://developer.apple.com/library/archive/documentation/DataManagement/Conceptual/CloudKitQuickStart/TestingYourApp/TestingYourApp.html), so any permitted future feature would need a deployed production schema, signing capabilities, local migration, durable offline changes, conflict/deletion handling and account isolation. That technical availability does not override the health-data restriction. Keep the health journal local.

## Content growth

Discover starts with bundled, original articles and recipes. Use stable content IDs, category, title, summary and structured article sections. Keep editorial content outside the health journal. Add a content-fetching adapter only when a real backend exists; preserve bundled content as an offline fallback. A CMS should deliver content, not executable screen layouts. Do not send personal tracking records to a content backend.

AI remains explicitly coming soon. A working assistant requires a separate decision about supported devices, availability, medical scope and consent. Do not build a chat backend as a prerequisite for tracking or reading content.

## Testing and release gates

For each behaviour change, first reproduce the missing behaviour through an existing public seam, then implement it and retain the regression test. Cover known numeric examples, invalid input, actual versus planned records, timezone/DST scheduling, persistence failures and historical edits. Avoid tests of private methods or view hierarchy details.

Use a separate simulator for UI tests. Test create/edit/relaunch, skip and overdue, notification enable/disable, chart detail navigation, dark mode and large text. Synthetic screenshot fixtures must use the same calculation code as the app. A passing core suite is not evidence of a working UI or successful TestFlight release.

## Scale when there is evidence

Keep atomic local JSON for this first release. Before release, finish schema migration tests and failed-load protection. Move to a database only if measured journal size or query requirements justify it, retaining the same behavioural tests. Extract notification coordination when its delivery rules are implemented and tested. Avoid generic repositories, dependency-injection frameworks, speculative sync engines and premature microservices.
