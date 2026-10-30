Reviewed against the latest [APPLE-SPEC.md](/tmp/www8-review-7/APPLE-SPEC.md), including the iteration-7 compositions and **9.0 iPhone Home gate**. Scores cover all 12 prototype captures. The five `refs/` images serve as benchmarks. **No `pages-*` files were present**, so those module pages remain unassessed.

| File | Score | Gate pass/fail |
|---|---:|---|
| main-home.png | 8.5 | **Fail** — requires 9.0 |
| main-lamps.png | 8.4 | **Fail** — requires 9.0 |
| main-clock-near.png | 8.8 | **Fail** — requires 9.0 |
| main-controls.png | 8.2 | **Fail** — requires 8.5 |
| main-nowplaying.png | 8.7 | **Pass** — requires 8.5 |
| main-dogwalk-tile.png | 8.2 | **Fail** — requires 8.5 |
| main-dogwalk-tile-running.png | 8.3 | **Fail** — requires 8.5 |
| main-dogwalk-full.png | 8.0 | **Fail** — requires 8.5 |
| main-dogwalk-full-running.png | 7.9 | **Fail** — requires 8.5 |
| main-dogwalk-remote.png | 7.9 | **Fail** — requires 8.5 |
| main-iphone-home.png | 8.0 | **Fail** — requires 9.0 |
| main-iphone-home-bottom.png | 8.2 | **Fail** — requires 9.0 |

The outer grid is disciplined. The remaining problems concern readability, hierarchy within controls, and optical finish. Concrete flaws, worst first; dimensions below are proposed native-point adjustments:

1. **Dog Walk loses essential information against the photograph.**  
   `main-dogwalk-full.png`, `main-dogwalk-full-running.png`, `main-dogwalk-remote.png`: the gray last-walk/device line dissolves into the sky. The full-screen buttons have approximately **2.0:1 white-to-green contrast**, substantially weaker than the tile’s black-on-green treatment. Use **black symbols and 24-pt semibold labels** on semantic green. Make the status line **24-pt primary white**, with a localized black scrim feathering from approximately **35% to transparent** behind the hero region.

2. **The phone scroll boundaries look smeared.**  
   `main-iphone-home.png`, `main-iphone-home-bottom.png`: the ivory Lamps tile dissolves into a conspicuous horizontal haze; the Music card’s upper contour similarly disappears into gray. This weakens otherwise clean geometry. Confine the fade to **8–12 pt at the viewport boundary**, using opacity rather than a broad blurred band. Retain the reserved **80-pt pager band** and **200×56-pt capsule**. Scrolling can reveal partial cards without making their surfaces look melted.

3. **Camera captions lack dependable separation from their image.**  
   `main-controls.png`, `main-dogwalk-tile.png`, `main-dogwalk-tile-running.png`: “2 demo feeds” crosses bright cloud and rock, while the repeated lake scene makes camera content merge perceptually with the wallpaper. Strengthen the camera’s localized top scrim to approximately **40–45% black**, feathered over **96 pt**. Keep captions **32 pt inside the tile**, with a separate restrained bottom scrim behind location and time.

4. **Dog Walk’s statistics need clearer meaning and hierarchy.**  
   `main-dogwalk-full.png`, `main-dogwalk-full-running.png`, `main-dogwalk-remote.png`: “3-week average” does not identify what is averaged. The three large statistics also compete with the running timer. Use **“Average per walk”**, with **“Past 3 weeks” at 20 pt**. Reduce statistic values to **48 pt**, retaining the **64-pt elapsed value**. Make the history footer an explicit **20-pt “View all 19 walks ›”** affordance; the current footer does not visibly explain how to reach the remaining history.

5. **Lamps has symmetry without a convincing shared alignment.**  
   `main-lamps.png`: the room cards sit roughly **80 pt above the fader’s vertical center**, hovering beside its count instead of bracketing the instrument. Move both cards down approximately **80 pt** to share the fader’s centerline. Preserve the **224×384-pt fader**, equal **280-pt room cards**, and **32-pt internal margins**. This would make the central control and room controls read as one composition.

6. **Home’s brightness control is visually dominant but verbally ambiguous.**  
   `main-home.png`: the large ivory surface attracts attention before the Climate hero, while “Turns all 8 on” leaves the triggering action unspecified. Change this to **“Adjusting turns / all 8 on”**, in **20-pt type**, with **16 pt separation** from the partial-on count. Recover space by shortening the inner fader approximately **16 pt**. Soften the native warm tint slightly while retaining black text and a clearly luminous white fill.

7. **Active-light appearance is inconsistent across platforms.**  
   `main-controls.png`, `main-dogwalk-tile.png`, `main-dogwalk-tile-running.png`, `main-iphone-home-bottom.png`: Cabinet is muddy gray-beige on iPad but luminous ivory on iPhone. Both say “On,” yet their visual emphasis differs substantially. Bring the iPad native active material toward the phone’s warm light treatment, with **semantic orange glyphs and black labels**. Establish the same perceived active-state brightness across these captures.

8. **The running Walk tile gives its label and value equal emphasis.**  
   `main-dogwalk-tile-running.png`: “Elapsed” competes with `12:34`, while the title is another similarly strong line. Set **Elapsed to 20 pt**, the timer to **40-pt rounded monospaced digits**, and the originating device to **20 pt**. Preserve the title and History anchors shared with `main-dogwalk-tile.png`, plus the separate **72-pt action**.

9. **The clock is clean, but its hands look undersized for the dial.**  
   `main-clock-near.png`: the short hour/minute hands leave a large empty annulus inside the numerals. Extend the minute hand approximately **24 pt** and the hour hand **16 pt**, retaining the specified **24-pt minimum glyph clearance throughout rotation**. Increase the charge complication to a **96-pt ring with a 36-pt value and 16-pt percent sign**; its value currently feels subordinate to the temperature complications. Keep its caption aligned with Zero’s caption.

10. **Now Playing passes, with residual contrast and affordance weaknesses.**  
    `main-nowplaying.png`: artwork, track information, transport, and volume form the strongest hierarchy in the set. The artist and source labels are nevertheless too subdued against plum. Raise their contrast while keeping **24-pt artist / 20-pt source text**. A **10–12-pt resting seek thumb** would distinguish the interactive scrubber more clearly from a passive progress indicator.

Stills establish visible geometry and contrast, but cannot verify native Liquid Glass implementation, motion, hit regions, scrolling behavior, full-sweep clock clearance, or cross-device synchronization. No deductions were made for fixture data or licensed imagery.

**Verdict: FAIL — 1 of 12 supplied prototype captures passes its gate; the missing module-page captures cannot be certified.**