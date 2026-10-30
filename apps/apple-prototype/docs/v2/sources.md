# Asset sources — iteration 4

Home/Controls wallpaper: **Boathouse on a mountain lake**, Luca Bravo, Lago di Braies (published 2016-08-09).

- Original: https://unsplash.com/photos/brown-house-near-body-of-water-zAjdgNXsMeg
- Licence: https://unsplash.com/license (Unsplash Licence, verified 2026-10-29; free redistribution/use including commercial use; not public domain).
- Download: https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=2752&q=85&fm=jpg
- Bundled file: `Sources/Assets.xcassets/LakeWallpaper.imageset/lake.jpg`, downsampled to 2752 pixels wide, JPEG quality 85. The app crops to fill and dims the wallpaper 40% for text contrast. No tile fill or custom glass edge is painted.
- Original fixture album cover is procedural SwiftUI art, unrelated to any actual release. Weather is condition-driven procedural artwork.
- Apple/Calum images remain in the external research directory and are never bundled or committed. Comparison sheets containing these references remain outside the repository.

Review evidence: `sim-*.png` is captured from the running iOS 26.3 simulators with `xcrun simctl io … screenshot`; `-snapshot` freezes fixture time and decorative phase. No ImageRenderer image is used for pass-4 scoring.
