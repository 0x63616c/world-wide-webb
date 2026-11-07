**The visual gate fails.** The outer grid is disciplined, but material restraint, internal alignment and control labeling remain below the requested standard.

I scored all 12 prototype captures against the latest applicable sections of [APPLE-SPEC.md](/tmp/www8-review-7e/APPLE-SPEC.md). The five `refs/` images are comparison material. No `pages-` files were supplied. Fixtures and licensed imagery incur no deduction. Both iPhone Home captures use the spec’s **9.0** gate.

| File | Score | Gate pass/fail |
|---|---:|---|
| [main-clock-near.png](/tmp/www8-review-7e/main-clock-near.png) | 8.8 | **Fail** — 9.0 |
| [main-controls.png](/tmp/www8-review-7e/main-controls.png) | 8.0 | **Fail** — 8.5 |
| [main-dogwalk-full-running.png](/tmp/www8-review-7e/main-dogwalk-full-running.png) | 8.6 | Pass — 8.5 |
| [main-dogwalk-full.png](/tmp/www8-review-7e/main-dogwalk-full.png) | 8.5 | Pass — 8.5 |
| [main-dogwalk-remote.png](/tmp/www8-review-7e/main-dogwalk-remote.png) | 8.6 | Pass — 8.5 |
| [main-dogwalk-tile-running.png](/tmp/www8-review-7e/main-dogwalk-tile-running.png) | 8.1 | **Fail** — 8.5 |
| [main-dogwalk-tile.png](/tmp/www8-review-7e/main-dogwalk-tile.png) | 8.0 | **Fail** — 8.5 |
| [main-home.png](/tmp/www8-review-7e/main-home.png) | 8.2 | **Fail** — 9.0 |
| [main-iphone-home-bottom.png](/tmp/www8-review-7e/main-iphone-home-bottom.png) | 8.3 | **Fail** — 9.0 |
| [main-iphone-home.png](/tmp/www8-review-7e/main-iphone-home.png) | 8.2 | **Fail** — 9.0 |
| [main-lamps.png](/tmp/www8-review-7e/main-lamps.png) | 8.5 | **Fail** — 9.0 |
| [main-nowplaying.png](/tmp/www8-review-7e/main-nowplaying.png) | 8.7 | Pass — 8.5 |

Worst-first fixes follow. Dimensions are proposed design adjustments in points, not claimed Apple requirements.

1. **The glass draws too much attention to the photograph beneath it.**  
   `main-home.png`, `main-controls.png`, `main-dogwalk-tile.png`, `main-dogwalk-tile-running.png`, and both iPhone captures: mountain edges, rooflines and warped highlights remain conspicuous inside reading surfaces. Fan, All lights, Calendar and Sonos are particularly affected. The supplied Apple references separate content from its surroundings more calmly. **Fix:** retain the 24-pt gutters and native materials, but use native regular glass for text-heavy controls—a deliberate revision to pass 7e’s clear-glass prescription. Keep clear glass for simpler controls. Preserve primary-white text and 32-pt panel/16–24-pt compact content insets; avoid solving this with another uniform wallpaper-darkening pass.

2. **Sonos breaks the otherwise convincing internal grid.**  
   `main-controls.png`, `main-dogwalk-tile.png`, `main-dogwalk-tile-running.png`: the narrow, deeply inset Sonos column and wrapped heading look squeezed beside spacious neighboring tiles. **Fix:** use one 28-pt “Sonos” heading, consistent 32-pt horizontal insets, 22-pt room names and 20-pt states. Set a 72-pt room-row cadence and retain the footer’s shared 32-pt bottom inset.

3. **The phone thermostat drops an important distinction.**  
   `main-iphone-home.png`: the large **70°** is unlabeled, while **Inside 72°** appears below. The iPad explicitly identifies the target; the phone requires inference. **Fix:** add a 12–13-pt secondary “Target” caption, 8 pt from the setpoint. Retain the 76-pt numeral and 48-pt action targets within the 216-pt card by tightening internal spacers.

4. **Lamps gives its consequential behavior too little emphasis.**  
   `main-lamps.png`: the oversized white fader dominates, while “Adjusting turns all 8 lamps on” is visually relegated to a gray footnote. The room controls feel secondary despite governing which lights are on. **Fix:** place that instruction directly below the partial-on count, using 20-pt primary text and an 8–12-pt gap. Keep the correctly centered 224×384-pt instrument and 64-pt side gaps; increase room switch/header rows to 64 pt for stronger wall-distance presence.

5. **Clock’s complication color competes with its dial hierarchy.**  
   `main-clock-near.png`: the green weather/paw/temperature glyphs and charging arc compete with the green cardinal numerals. The car ring also departs from the spec’s white complication treatment. **Fix:** use primary white for complication symbols and the charge arc, a subdued neutral track, and reserve semantic green for cardinal numerals and the seconds hand. Normalize the small symbols within 32-pt frames. The dial clearance and footer placement are already convincing.

6. **The Walk period selector is underscaled for this panel.**  
   `main-dogwalk-full.png`, `main-dogwalk-full-running.png`, `main-dogwalk-remote.png`: “7 days / 30 days” is noticeably smaller than neighboring chart and history text. **Fix:** use 18-pt medium labels within the existing 48-pt control. In the idle capture, reduce “Zero’s walks” to 40 pt to temper its competition with the statistics. Preserve the stable panel positions and clear local/remote origin labels.

7. **The phone’s two wide information cards miss a shared text axis.**  
   `main-iphone-home-bottom.png`: Car’s text starts slightly farther right than Music’s, despite nearly identical compositions. **Fix:** give both a 72-pt artwork/symbol column, 16-pt leading inset and 16-pt text gap—placing text 104 pt from each tile’s leading edge. Retain the complete Music contour and reserved pager space.

8. **Now Playing’s room destination is unnecessarily cryptic.**  
   `main-nowplaying.png`: the isolated upper-right speaker/group symbol lacks the clarity of the labeled playback controls. **Fix:** add a 17–20-pt “Rooms” label in a native glass control at least 64 pt high. Preserve the 440-pt artwork, aligned track information and transport/volume order; this is the most resolved full-screen composition.

Stills establish visible hierarchy, geometry and material appearance. They cannot verify native-glass implementation, touch regions, scrubbing, scrolling, motion, changing-photo contrast, accessibility behavior or full-sweep clock clearance. No code was inspected.

**Verdict: FAIL — 4 of 12 supplied prototype captures pass; Home, Lamps, clock-near and both iPhone Home captures remain below 9.0.**