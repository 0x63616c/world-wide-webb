# App Store preparation — November 8, 2026

Prepared in an isolated worktree from current main `5e68d7e37958acf5d748b7b74c5c79e9e298439d`, preserving other chats' changes. Capture/implementation source is `6a768f3eb16049a10e9ef205796d5f98adb61efc` (preceded by `4b9f9e9` and `42387f3`). This is reversible draft listing preparation under #42, not submission or full shipping acceptance.

## Current views and templates

Adapted Tendr's tracked label, bold headline, graphite backgrounds and thin frame to complete real Folding views. Current fixture version 2/caption version 3 includes Today, History, Patterns, Leaderboard and Milestones, with realistic profile/badge state and all ten locales. Descriptions now cover actual folds/time, History, Patterns, iCloud/widgets, optional competition/profiles/badges and CSV export. Outdated JSON export and unimplemented marketing claims were removed.

The direct hosted XCTest target renders production views with fixed fixtures and no live clients. The native inner window is **951 × 669 points**, landscape; the outer is **466 × 678 points**, portrait. Each capture checks actual window-scene geometry. Forcing the wide host into the closed display gave incorrect native chrome; that attempt was rejected. Only the corrected native Open/Closed captures are accepted. The capture runner pauses for Device Hub pose acknowledgment and owns/cleans its temporary simulator.

Each locale has ten ordered Duo images (outer then inner per scene) and five medium canvases preserving the outer capture's aspect ratio. All 150 images have opaque sRGB output, validated dimensions/upload-slot classification and SHA-256 provenance. The English uncaptioned Tip jar image remains separate and matches all three product prices.

Independent read-only review accepted all 150 images and the reviewer Tip jar image. No clipping, wrong-language fallback or native geometry defect was found. This is not native-language stylistic approval or full app accessibility acceptance.

## Verification

- Full current-source capture completed: twenty locale/display XCTest runs plus reviewer capture, with every expected tuple present. Task-owned simulator was shut down/deleted; both pre-existing booted simulators were preserved and the original Device Hub selection restored.
- Frame suite: 150 renders / 451 assertions. Listing readback: two tests / ten assertions. Draft uploader: one test / nine assertions. Existing release regressions: seven tests / twenty assertions. Generic simulator build-for-testing, Swift formatting, Ruby syntax and lane loading passed during implementation.
- App and embedded widget privacy manifests are packaged in the built products. App: UserDefaults `CA92.1`, FileTimestamp `C617.1`, SystemBootTime `35F9.1`; widget: latter two. Tracking false. These API-reason manifests do not replace App Store data declarations.

## Apple setup

Saved declarations are versioned in `fastlane/apple-declarations.json`. The owner approved publication of the privacy answers and confirmed necessary content rights.

- App Privacy **published**, visibly confirmed by Apple. App Functionality purpose only; six data types linked to identity, bounded diagnostics not linked, no tracking. Policy URL is the live `/privacy/` page.
- Age rating saved: calculated **13+**, regional variations and older-system global 12+ exceptions. User-generated profiles/avatars are declared; ongoing leaderboard/personal-goal competition meets Apple's Contests definition. No rating override.
- Content rights saved using the owner's explicit confirmation. The privacy notice documents public display of profile names and avatars; no external media catalogue is claimed.
- Review contact copied from the owner's other apps. The new number is stored in Folding's 1Password release contact and both repositories' release secrets; all **eight existing non-staging app review records**, including previous versions, were updated and independently read back. Contact values stay out of this repository.

The draft remains version **1.0**, ID `461e7aec-0cf3-4a57-a899-99b38e36c252`, `PREPARE_FOR_SUBMISSION`. Automatic release after approval remains selected. No binary selection or App Review submission was performed.

## Verified draft upload

`storefront_draft version:1.0` succeeded at **2026-11-08 19:14:56 UTC**. Apple readback verified all ten listing locales, categories, names/subtitles/privacy URLs, copyright, description/keywords/URLs/promotional text and all 150 processed screenshots. Each locale has `APP_IPHONE_DUO` × 10 and `APP_IPHONE_61` × 5; every gallery matches expected order, checksum, size and dimensions. First-version release notes are inapplicable. [Committed readback](storefront-2026-11-08/apple-draft-readback.json) and [independent visual scope](storefront-2026-11-08/visual-review.json).

## Remaining release gates

The existing internal build **0.1.13 (14)** is not a new signed 1.0 candidate containing these manifests. Full release preflight also requires all configured backend capabilities; current production source `091b09f359526cb81cf9b16de13fb750803eb579` advertises only the accepted `profiles.milestones` capability. Do not enable unverified capabilities to bypass that gate.

Keep full rehearsal and broader provider/product acceptance under #43/#12, formal native-language/accessibility acceptance under #25/#71, CI under #46, actual submission, and owner-deferred physical checks under #47/F13 open. Screenshots and Apple draft setup do not mark these passed or establish the public Duo compatibility badge.

## Durable handoff

Implementation/evidence is pushed in [draft PR #79](https://github.com/0x63616c/folding/pull/79). The [private draft asset release](https://github.com/0x63616c/folding/releases/tag/untagged-76c6ed3990bf68e52774) preserves raw/composed captures, listing files/manifests, separate tip review image/map, independent review and Apple readback/proof. GitHub's uploaded asset digest and size match the local archive: SHA-256 `d95cb4efb46e5403d06b65e67c19e6bceeb02a98d66e6808c1d3a375015eaaa1`. This is a preparation backup, not the final signed release manifest.

Repository pre-push checks passed: contracts, localization, icon reproducibility, Swift/OpenTofu formatting, 109 personal-core and 29 widget tests. No simulator was booted by these checks. Original shared checkout and pre-existing device sessions remain intact.
