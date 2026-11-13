# App icon and Today pending state

November 7, 2026. Implemented and app/widget simulator build passed.

The selected white twin-panel mark on black lives in
`apps/ios/Branding/icon-selected.png`. `swift scripts/generate-app-icons.swift`
reproducibly generates the three committed opaque 1024-pixel PNGs. `--check`
verifies that outputs match and runs from `scripts/check`. All appearances use
the selected composition; there is no text, screenshot content, or baked corner mask.
The website uses a scaled copy at `apps/web/assets/icon-selected.png`.

The asset catalog provides Any/Dark/Tinted single-size variants; Xcode generates
required platform sizes. The real app target specifies AppIcon and includes the
catalog. The build generated Assets.car, resized icon resources, and
CFBundlePrimaryIcon → AppIcon. System clear treatments are not separately authored
layered Icon Composer assets. Final Home Screen appearance review remains pending.

November 12, 2026: the icon generator lowers the selected mark by five pixels on
the 1024-pixel canvas to balance its top and bottom padding. The three committed
appearance variants were regenerated and visually checked; this does not change
the website artwork or complete the deferred Home Screen review.

Apple references: [asset catalog configuration](https://developer.apple.com/documentation/xcode/configuring-your-app-icon)
and [app icon guidance](https://developer.apple.com/design/human-interface-guidelines/app-icons).

Today now reads journal-backed pending public reset/upload state on normal refresh.
Only one compact status row appears, prioritized after required setup/history/device
attention. Reset pending takes priority over pending folds. Tapping opens Sync;
healthy state adds no banner. No optimistic public count or cloud-convergence claim
is introduced. The public upload queue must acknowledge the work before the status
clears. Full native status-transition rendering remains final-pass acceptance.

Validation: regeneration/check passed; PNG dimensions and alpha rules inspected;
localization passed with 215 semantic keys × ten locales; generic app/widget build
passed (`/tmp/folding-branding-build.log`). The selected icon was inspected as an
artifact; final device/Home Screen appearance review remains pending.
