# Tip jar reviewer capture scene

November 7, 2026. Deterministic scene implemented; final image capture awaits live
readback of all three configured App Store Connect products.

`TipJarContent` contains the same native Form used by production `TipJarView`.
Production maps real StoreKit product names/display prices and purchase actions.
The dedicated simulator-only screenshot target renders the same component using
`fastlane/tip-products.json` as a bundled fixture source. No price/name constant is
duplicated in screenshot code. The source's en-US names and USD base prices are
formatted in en-US; invalid/missing fixtures fail launch.

Launch scenario is `tipjar`, with `en-US` (or `en`) and light appearance only.
`FoldingScreenshotTests/testTipJar` captures `tipjar`. Hit testing is disabled and
purchase/retry closures fail if called; the target does not instantiate StoreKit,
authentication, tracking, CloudKit, notification or network services. It depicts the
tip selection screen, never a fabricated Apple purchase dialog.

This is a reviewer-only artifact, separate from the four storefront scenarios.
Release packaging owns dedicated capture directories, manifest/provenance and upload
mapping. Screenshot target build-for-testing passed in
`/tmp/folding-tip-review-build.log`; this does not certify a captured PNG, device
render, product availability or purchase success. Localization remains 215 keys
across ten locales because existing native copy is reused.
