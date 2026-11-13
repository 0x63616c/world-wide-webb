# RDesign

Tendr-local Swift package. Import `RDesign` from an iOS 17+ or macOS 14+ target via the
local package at `projects/tendr/Packages/RDesign`.

- `RPalette`, `RFont`, `RSpacing`, `RRadius`: black/white/graphite, type and layout tokens.
- `.card()`, `.rRow()`, `PageHeader`, `FilterBar`: common layouts.
- `InfoButton`, `RHelpLinks`, `RLinkRow`, `RVersionFooter`: settings and explanations.
- `RMark`, `RSplash`: the app’s own `LaunchGlyph` asset on a neutral surface.
- `RTipJar`, `RSupportRow`, `RTipJarSheet`, `RTipThanks`: optional consumable tips, with app-supplied product IDs. Hide the support row unless the store is ready.

`swift test --package-path projects/tendr/Packages/RDesign` tests portable frame configuration and metrics on Linux. Apple platforms also compile the SwiftUI/StoreKit code and run its additional tests. Native builds and StoreKit UI tests remain necessary.

```sh
swift run --package-path projects/tendr/Packages/RDesign -c release rframe \
  projects/tendr/screenshots.json build/screenshots/tendr/raw \
  projects/tendr/fastlane/screenshots/en-US build/screenshots/tendr/overview.png
```

`rframe` needs macOS/AppKit and writes opaque 1320×2868 PNGs. Each `shots` entry supplies `screen` (capture basename), optional `appearance` (`light` by default or `dark`), `eyebrow`, and `headline`. Raw captures live under `<raw-dir>/<appearance>/<screen>.png`. Linux tests validate this configuration; they do not render frames.
