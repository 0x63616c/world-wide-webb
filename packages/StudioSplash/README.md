# StudioSplash

The World Wide Webb launch splash, shared by Control Center and Tapes: a spinning pixel globe,
the WORLD WIDE WEBB wordmark and a loading bar picked at random from eight designs. The letters
hop one at a time; filling bars drive the hops so the wave follows the fill.

## Use it in an app

Add the package to the app's `project.yml` (`packages:` with a relative `path`, then
`- package: StudioSplash` under the target's dependencies), then:

```swift
import StudioSplash

StudioSplash(pixel: 6)  // points per art pixel; keep it a whole number
```

`SplashGlobe`, `SplashWordmark` and `SplashBar` are public too, for layouts that place the parts
separately. Give `SplashWordmark` and `SplashBar` the same `SplashSheets.Bar` so the wave and the
bar stay in step; `SplashSheets.shared.randomBar()` picks one. Reduce Motion stops the globe and
the wave; the bar keeps moving because it is the loading indicator.

## Sheets for other apps

Everything lives in `Sheets/` as plain PNG and JSON, so a game or web app can load it without
Swift. The Swift package compiles the same bytes in (`EmbeddedSheets.swift`) instead of shipping a
resource bundle, which would need its own signing settings when an app archives.

- `globe.png`: 8 frames of 41 × 41 in a row, 8 fps. Rows 0 and 40 are empty.
- `wordmark.png`: 65 × 5. `letters` in the manifest gives each letter's first and last column.
- `bars.png`: one row per bar design, 100 frames of 65 × 5 each, 50 fps (a 2 s loop).
- `splash.json`: sizes, frame rates, the layout (positions in art pixels on a 65 × 57 canvas,
  with even 4 px gaps between the visible parts) and, per bar, `hops`: the letter raised by 1 px
  in each bar frame, or -1.

Colours are white `#EBEDE9` and slate `#202E37` on transparency. Draw with nearest-neighbour
scaling at a whole number of device pixels per art pixel.

## Change the art

`Design/globe.aseprite` is the globe source. Its layers split the parts that never change (outline
and front rings, polar cap, back rings, each one shared by all 8 frames) from the meridians drawn
per frame. Frames 5 to 7 mirror frames 3 to 1; after editing frames 0 to 4 and the left halves,
`Design/mirror_globe.lua` mirrors the rest:

```sh
aseprite -b --script-param src=globe.aseprite --script-param out=globe.aseprite --script mirror_globe.lua
```

The wordmark font and the bar designs are drawn in `Design/generate.py`. Regenerate the sheets
and manifest (needs Aseprite installed) with:

```sh
uv run packages/StudioSplash/Design/generate.py
```

It refuses to write a bar that leaves the palette or moves more than 1 px between frames (the
stepped chevron design moves a whole chevron at a time on purpose). `swift test --package-path
packages/StudioSplash` checks the sheets against the manifest, the layout spacing, and that the
embedded copy matches `Sheets/`.
