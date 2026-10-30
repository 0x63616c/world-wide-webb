The layouts are coherent, but Home’s control finish and phone scroll edges remain below the required standard. I used the latest superseding provisions in [APPLE-SPEC.md](/tmp/www8-review-7b/APPLE-SPEC.md), including the **9.0 gate for iPhone Home**. No deductions for fixtures or licensed imagery.

All 17 available images are scored below. References are assessed in their own device context and excluded from the product gate. **No `pages-*` files were present**, so Weather, Calendar, Media library, Video, Sonos Rooms, and Photos full-screen pages remain unassessed.

| File | Score | Gate pass/fail |
|---|---:|---|
| main-home.png | 8.4 | **Fail** — 9.0 |
| main-iphone-home.png | 8.3 | **Fail** — 9.0 |
| main-iphone-home-bottom.png | 8.2 | **Fail** — 9.0 |
| main-lamps.png | 9.0 | Pass — 9.0 |
| main-clock-near.png | 9.1 | Pass — 9.0 |
| main-controls.png | 8.3 | **Fail** — 8.5 |
| main-dogwalk-tile.png | 8.3 | **Fail** — 8.5 |
| main-dogwalk-tile-running.png | 8.4 | **Fail** — 8.5 |
| main-dogwalk-full.png | 8.6 | Pass — 8.5 |
| main-dogwalk-full-running.png | 8.7 | Pass — 8.5 |
| main-dogwalk-remote.png | 8.7 | Pass — 8.5 |
| main-nowplaying.png | 8.8 | Pass — 8.5 |
| refs/apple-music.png | 9.1 | N/A — reference |
| refs/apple-weather.png | 9.3 | N/A — reference |
| refs/ipad-control-center-26-0.png | 9.0 | N/A — reference |
| refs/ipad-home-26-2.png | 8.9 | N/A — reference |
| refs/watch-infograph.png | 9.5 | N/A — reference |

Worst-first concrete flaws follow. Dimensions are proposed adjustments in points; colour targets should use the spec’s semantic/native treatments.

1. **main-home.png — The brightness instrument loses its boundary.** Its white filled portion nearly disappears against the cream card: sampled colours are `#FFFFFF` and `#FFF5ED`, approximately **1.07:1** luminance contrast. The dark unfilled portion consequently defines the instrument more strongly than the actual brightness fill. Give the complete fader an **8-pt neutral material recess** visible around its perimeter, with an appearance near `#48484A`. Preserve the white fill and black sun.

2. **main-iphone-home.png; main-iphone-home-bottom.png — Scroll-edge finishing looks unfinished.** The initial view leaves an isolated curved tile rim immediately above the pager; the scrolled view washes away the Music card’s upper edge. Partial content is expected during scrolling, but these remnants look accidental. Fade the complete tile surface and its highlight together within the specified **8 pt**, and leave **16 pt of clear visual separation** before the pager capsule. Preserve the **56-pt capsule and 80-pt reserved band**.

3. **main-controls.png; main-dogwalk-tile.png; main-dogwalk-tile-running.png; main-iphone-home-bottom.png — “Some on” looks like “Off.”** All lights uses essentially the same dark surface and white glyph as the inactive Ceiling control, while Cabinet has an unmistakable active treatment. Give the mixed state a **semantic-orange glyph**, retaining the explicit “Some on” label. Keep fully inactive lighting glyphs neutral. The distinction should survive a glance without reading every subtitle.

4. **main-home.png; main-controls.png; both iPhone captures — The glass reads predominantly as smoked panels.** Climate, Music, and Walk show broad, nearly uniform charcoal interiors, with much of their separation coming from thin perimeter lines. That is readable, but less materially convincing than the supplied Control Center reference. Reduce the neutral tint’s visual dominance while retaining regular glass beneath text. Let native highlights provide edge definition. The Weather tile’s conspicuous blue perimeter also reads like selection chrome; soften that edge so the sky content establishes its identity.

5. **main-controls.png; main-dogwalk-tile.png; main-dogwalk-tile-running.png — Internal alignment is weaker than the excellent outer grid.** “History,” “Browse library,” and “All 5 rooms” sit at unrelated heights despite their panels sharing a lower edge. Establish a common footer-action baseline with **32-pt bottom insets and 20-pt labels**. In the running Walk tile, give the originating-device line and History link at least **8 pt of clear separation**; that corner is noticeably denser than the surrounding tiles.

6. **main-dogwalk-full.png; main-dogwalk-full-running.png; main-dogwalk-remote.png — Chart controls are undersized for the wall-panel typography.** The period-selector labels look approximately **14 pt**, isolated among much larger headings and statistics. Increase them to **20-pt medium**, using roughly **120 × 48-pt segments**. Raise chart-axis labels to **20 pt** as well. Preserve the stable status region and aligned chart/history panels; those are successful.

7. **main-nowplaying.png — Secondary controls need stronger visual definition.** The unfilled seek and volume tracks recede into the purple field. Target approximately **3:1 local contrast** with **4–6-pt tracks**, preserving the white played portion. The upper-right speaker icon is also an ambiguous destination: a **“Rooms” label at 20 pt** in a compact native-glass control would clarify its purpose without disturbing the artwork-led composition.

8. **main-lamps.png; all three full-screen Dog Walk captures — Modal chrome is inconsistent.** Lamps’ close circle appears approximately **78 pt**, versus roughly **70 pt** on Dog Walk, and their vertical centres differ. Standardize these to **72-pt visible circles**, **44-pt leading inset**, and a shared title/control centreline. Lamps otherwise earns its pass: the fader, symmetric room cards, switches, and separate disclosures form a clear instrument.

9. **main-clock-near.png — Minor distance-readability refinements remain.** The seconds hand is fragile beside the substantial hour/minute hands, and the percent unit is disproportionately small. Use a **2-pt seconds stroke** and **20-pt percent unit**. Preserve the dial proportions, restrained palette, clear complication zones, and shared footer baseline; this is the strongest overall composition.

No code was inspected. Stills establish composition and rendered contrast, but cannot certify native glass behavior in motion, hit regions, gesture discoverability, full-sweep clearance, Dynamic Type, reduced-motion behavior, or cross-device synchronization.

**Verdict: FAIL — six supplied prototype captures miss their gates, and the six absent module pages prevent complete sign-off.**