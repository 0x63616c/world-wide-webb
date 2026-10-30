# Asset sources — iteration 4

Home/Controls wallpaper: **Boathouse on a mountain lake**, Luca Bravo, Lago di Braies (published 2016-08-09).

- Original: https://unsplash.com/photos/brown-house-near-body-of-water-zAjdgNXsMeg
- Licence: https://unsplash.com/license (Unsplash Licence, verified 2026-10-29; free redistribution/use including commercial use; not public domain).
- Download: https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=2752&q=85&fm=jpg
- Bundled file: `Sources/Assets.xcassets/LakeWallpaper.imageset/lake.jpg`, downsampled to 2752 pixels wide, JPEG quality 85. The app crops to fill and dims the wallpaper 40% for text contrast. No tile fill or custom glass edge is painted.
- Original fixture album cover is procedural SwiftUI art, unrelated to any actual release. Weather is condition-driven procedural artwork.
- Apple/Calum images remain in the external research directory and are never bundled or committed. Comparison sheets containing these references remain outside the repository.

Review evidence: `sim-*.png` is captured from the running iOS 26.3 simulators with `xcrun simctl io … screenshot`; `-snapshot` freezes fixture time and decorative phase. No ImageRenderer image is used for pass-4 scoring.

## Pass 5 bundled media

All downloaded 2026-10-29. No Apple or Calum reference image is bundled.

| Asset | Source / author | Licence | Processing / use |
| --- | --- | --- | --- |
| ForestPhoto | [Pathway of trees during daytime](https://unsplash.com/photos/pathway-of-trees-during-daytime-P1Iz3unD6Po), Johannes Plenio | [Unsplash Licence](https://unsplash.com/license) | 2752×1548 JPEG, quality 85; Photos and explicitly simulated Woodland feed |
| CoastPhoto | [Sunset](https://unsplash.com/photos/sunset-CA5mR_jecac), Luca Bravo | [Unsplash Licence](https://unsplash.com/license) | 1823×2752 JPEG, quality 85; Photos |
| LakeStudy.mp4 | Existing LakeWallpaper, Luca Bravo (source above) | Unsplash Licence | Local FFmpeg slow zoom, silent 12-second H.264 at 1280×720/25 fps; AVKit demo film |

Camera scenes are stock landscapes, not photographs of a user's home. Music covers, track names, albums and playlists are original authored fixtures; the prototype does not bundle recordings or imply real music output.

CloudPhoto: [Blue sky with white clouds](https://unsplash.com/photos/blue-sky-with-white-clouds-xtgONQzGgOE) by uriel (@xaze), [Unsplash Licence](https://unsplash.com/license). Downloaded 2026-10-29, JPEG quality 85, longest edge 2752 px. Weather condition artwork with slow TimelineView drift; clear skies use original SwiftUI sky/sun, rain adds original particles and desaturation.
