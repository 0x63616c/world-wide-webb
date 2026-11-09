# iPhone Duo App Store requirements

Verified against Apple documentation on 2026-11-08. This note distinguishes native layout readiness, the product-page badge, and editorial featuring.

## Native readiness and badge

- Apple identifies iOS 27.1 SDK or later builds as optimized for Duo: they use the full display and place toolbars/tab bars vertically beneath the status bar. Test those vertical bars, folding/resizing, all device poses, and orientations in Xcode 27.1's Duo simulator. Earlier SDK builds run with layout limitations. [Apple preparation guide](https://developer.apple.com/iphone-duo/prepare/)
- **The documented badge trigger is submitting Duo screenshots in App Store Connect.** Apple does not describe a separate badge opt-in or entitlement. The absence of an extra opt-in is an inference from the published workflow; building with the new SDK alone is not the documented badge trigger. [Apple preparation guide](https://developer.apple.com/iphone-duo/prepare/)
- For editorial consideration, Apple separately recommends a featuring nomination whose **Helpful Details** describe Duo optimization, including all device poses. This is distinct from the badge. [Apple preparation guide](https://developer.apple.com/iphone-duo/prepare/)

## Screenshot files

- Outer display: **1398 × 2034** or **2034 × 1398** pixels.
- Inner display: **2007 × 2853** or **2853 × 2007** pixels.
- Supported formats: JPEG/JPG/PNG; no alpha channel or transparency. General limit: at least one and at most ten screenshots per device size.
- The specifications do not explicitly say that both displays or both orientations are mandatory for the badge. Capture inner and outer examples to demonstrate support; do not claim an undocumented minimum.
- Current general required device sizes include iPhone with Dynamic Island (medium display), plus iPad 13-inch if supporting iPadOS. Duo assets supplement these.
- The specification says Duo screenshots become required in **April 2027 for apps using iOS 27.1 SDK or later**. [Apple screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications)

Apple's October 5 announcement describes the April 2027 requirement more broadly as applying to any submitted apps/games. Use the more specific SDK-qualified screenshot reference for planning, and recheck before submission. [Apple announcement](https://developer.apple.com/news/?id=kkphp5qo)

## Upload and place screenshots

Required role: Account Holder, Admin, App Manager, or Marketing.

1. In App Store Connect **Apps**, select Tendr and the relevant iOS version in the sidebar.
2. Choose the localization, then **Product Page Information → App Previews and Screenshots**.
3. Select the device tab; use **View All Sizes in Media Manager** for the full device-size/localization controls and Duo placement.
4. Upload/drag files into the appropriate well, or **Browse Assets** for compatible approved images. Arrange their display order, then submit for review.

Assets can also be uploaded in **Asset Library → + → Previews and Screenshots**, then selected for a product-page placement. Uploading a file into Asset Library alone should not be treated as proof that the live product page has the badge. Apple documents editable upload statuses including Prepare for Submission and rejected states. [Apple asset-management guide](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-your-app-store-assets)

## Featuring nomination

In **Apps → Tendr → Featuring → Nominations**, select **+ → Create Nomination** (or **Get Started** initially). Name it, choose **App Enhancements**, describe the update, set a publication date/range, and save. Add Duo details in **Additional Information → Helpful Details**; optional supplemental links can include supporting materials. Review and select **Submit Nomination**, then confirm. Apple recommends at least three weeks' lead time. Nominations are considered for featuring; submission does not guarantee selection. Required roles match asset management. [Apple nomination guide](https://developer.apple.com/help/app-store-connect/manage-featuring-nominations/nominate-your-app-for-featuring)

## Tendr evidence to retain

Keep synthetic-fixture Duo screenshots, simulator/layout verification, the uploaded asset placements, and the resulting product-page badge as separate evidence. This research does not verify Tendr's current App Store Connect settings, submitted assets, or live badge.

On 2026-11-08, the primary agent reported that [release run 42477098949](https://github.com/0x63616c/apps/actions/runs/42477098949) failed in `DuoScreenshotTests.testEditorActionsSurviveCompactHeight`: Device Hub did not acknowledge the requested control. Listing upload and submission were skipped; this run therefore does not establish published Duo assets or badge availability.
