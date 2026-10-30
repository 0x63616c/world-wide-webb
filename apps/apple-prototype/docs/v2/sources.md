# Asset sources — iteration 4

Home/Controls wallpaper: **Boathouse on a mountain lake**, Luca Bravo, Lago di Braies (published 2016-08-09).

- Original: https://unsplash.com/photos/brown-house-near-body-of-water-zAjdgNXsMeg
- Licence: https://unsplash.com/license (Unsplash Licence, verified 2026-10-29; free redistribution/use including commercial use; not public domain).
- Download: https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=2752&q=85&fm=jpg
- Bundled file: `Sources/Assets.xcassets/LakeWallpaper.imageset/lake.jpg`, downsampled to 2752 pixels wide, JPEG quality 85. The earlier Home wallpaper cropped to fill; current detail uses retain their existing dimming. No tile fill or custom glass edge is painted.
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

## Pages branch reuse (2026-10-29)

`PagesAlbumArtwork` reuses the already-recorded CloudPhoto (uriel / Unsplash) and ForestPhoto (Johannes Plenio / Unsplash) as backgrounds for original fixture playlist covers. The type compositions are original, rendered in SwiftUI. LakeWallpaper, ForestPhoto and CoastPhoto are reused for Photos and clearly labelled demo camera feeds; LakeStudy.mp4 remains the silent original licensed study. No new external image or Apple reference is bundled by the pages branch. Research links: `pages-research.md`.

Pass 5b adds no downloaded imagery. Walk Zero uses SF Symbols, native Swift Charts and authored generic walk fixtures. Its surfaces reuse the licensed LakeWallpaper above. ActivityKit implementation reference: https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities ; custom glass: https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views .


## Pass 7c Home/More wallpaper trial

Home and More reuse the existing **ForestPhoto**, [Pathway of trees during daytime](https://unsplash.com/photos/pathway-of-trees-during-daytime-P1Iz3unD6Po) by Johannes Plenio, under the [Unsplash Licence](https://unsplash.com/license). The original page explicitly identifies the free Unsplash licence; source/licence rechecked 2026-10-30. Existing bundled file: `Sources/Assets.xcassets/ForestPhoto.imageset/photo.jpg`, 2752×1548 JPEG, quality 85. The shell crops it to fill, blurs by 2 pt and dims 28%; regular glass supplies refraction. No new image downloaded. Other detail backgrounds retain their existing lake default.


## Pass 7d Home/More wallpaper trial

The rejected ForestPhoto backdrop is replaced in this candidate by the already-bundled **CoastPhoto**, [Sunset](https://unsplash.com/photos/sunset-CA5mR_jecac) by Luca Bravo, [Unsplash Licence](https://unsplash.com/license). Source and licence rechecked 2026-10-30. Existing file `Sources/Assets.xcassets/CoastPhoto.imageset/photo.jpg`: 1823×2752 JPEG, quality 85. The shell uses a top-anchored fill crop, 75% photographic saturation, 2-pt blur and 28% dimming. No new image, asset edit or simulated glass. Home’s Photos tile reuses the existing photo collection; the parallel full-screen renderer is unchanged.


Pass 7e restores the existing **LakeWallpaper**, [Boathouse on a mountain lake by Luca Bravo](https://unsplash.com/photos/brown-house-near-body-of-water-zAjdgNXsMeg), under the [Unsplash Licence](https://unsplash.com/license), already verified 2026-10-29. Bundled at 2752 pixels wide, JPEG quality 85. Home applies 65% saturation and 62% global dimming without global blur; native clear glass supplies refraction. No new image is downloaded. This supersedes the forest/coast Home trials; other licensed photo uses remain.
