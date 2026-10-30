Grid alignment is largely resolved. Material balance and control hierarchy still block acceptance.

Scored all 12 prototype captures. The five `refs/` images are comparison references; no `pages-*` files were available. iPhone Home uses the spec’s explicit **9.0** gate. No deductions for fixture data.

| File | Score | Gate pass/fail |
|---|---:|---|
| [main-clock-near.png](/tmp/www8-review-7b/main-clock-near.png) | 9.1 | PASS ≥9.0 |
| [main-controls.png](/tmp/www8-review-7b/main-controls.png) | 8.3 | FAIL ≥8.5 |
| [main-dogwalk-full-running.png](/tmp/www8-review-7b/main-dogwalk-full-running.png) | 8.6 | PASS ≥8.5 |
| [main-dogwalk-full.png](/tmp/www8-review-7b/main-dogwalk-full.png) | 8.5 | PASS ≥8.5 |
| [main-dogwalk-remote.png](/tmp/www8-review-7b/main-dogwalk-remote.png) | 8.6 | PASS ≥8.5 |
| [main-dogwalk-tile-running.png](/tmp/www8-review-7b/main-dogwalk-tile-running.png) | 8.4 | FAIL ≥8.5 |
| [main-dogwalk-tile.png](/tmp/www8-review-7b/main-dogwalk-tile.png) | 8.3 | FAIL ≥8.5 |
| [main-home.png](/tmp/www8-review-7b/main-home.png) | 8.3 | FAIL ≥9.0 |
| [main-iphone-home-bottom.png](/tmp/www8-review-7b/main-iphone-home-bottom.png) | 8.4 | FAIL ≥9.0 |
| [main-iphone-home.png](/tmp/www8-review-7b/main-iphone-home.png) | 8.3 | FAIL ≥9.0 |
| [main-lamps.png](/tmp/www8-review-7b/main-lamps.png) | 9.0 | PASS ≥9.0 |
| [main-nowplaying.png](/tmp/www8-review-7b/main-nowplaying.png) | 8.8 | PASS ≥8.5 |

Concrete flaws, worst first. Dimensions below are proposed fixes in **pt**.

1. **Home surfaces look heavy, with insufficient material distinction.**  
   `main-home.png`, `main-controls.png`, both iPhone captures, and both Dog Walk tile captures: Climate, Music, Car and Walk read predominantly as charcoal panels; their thin perimeter highlights carry much of the apparent depth. The nearly opaque cream active controls then dominate disproportionately. Trial a **10–15% reduction in tint contribution**, retaining native regular glass for text and restrained semantic warmth for active lights. Preserve white primary text and strong contrast; improve local material variation without increasing wallpaper sharpness.

2. **The phone scroll boundaries visibly damage the card silhouettes.**  
   `main-iphone-home.png`: an isolated curved tile-edge sliver appears immediately above the pager. `main-iphone-home-bottom.png`: the Music card enters through a flattened, hazy upper edge. These look unfinished at the captured offsets. Apply the specified **8-pt fade to the complete composited tile, including its material edge**, and clip consistently at the scroll boundary. Keep the **80-pt pager reservation** and **200×56-pt capsule**.

3. **Home’s brightness instrument loses separation inside its bright container.**  
   `main-home.png`: the white lower fader nearly merges into the cream tile, while the tall cream area competes with Climate’s intended dominance. Give the entire fader a darker **native material recess with an 8-pt surround**, preserving its white fill and warm outer state. Keep **16 pt between the partial-on count and helper**. The instrument should be identifiable before reading “65%.”

4. **Home · More has inconsistent title ranks and ambiguous aggregate control intent.**  
   `main-controls.png`, `main-dogwalk-tile.png`, `main-dogwalk-tile-running.png`: “Walk Zero” is visibly stronger than the equivalent Cameras and Media headings; Sonos playback metadata competes closely with room names. Use **32-pt semibold wide-tile headings**, **24-pt room names**, and **20-pt secondary playback metadata**, with consistent **32-pt wide-tile insets**. “All lights / Some on” also leaves the tap’s result unclear. Use an action-specific secondary label matching the actual command, such as **“Turn all off”**, at **20 pt on iPad / 17 pt on iPhone**.

5. **Dog Walk’s hero and reporting sections use competing leading edges.**  
   `main-dogwalk-full.png`, `main-dogwalk-full-running.png`, `main-dogwalk-remote.png`: hero content begins at approximately **96 pt**, while statistics and panel headings begin at **124 pt**. That step weakens the otherwise stable composition. Align hero content to the **124-pt inner reading column** and inset the action symmetrically from the history panel’s outer edge. Preserve the fixed **144-pt status allocation**. Increase period-selector labels to **20 pt** within the existing **48-pt control height** for wall-distance reading.

6. **The seek control looks less actionable than the volume control.**  
   `main-nowplaying.png`: volume has an obvious thumb; the time scrubber looks like passive progress. Add a restrained **8–10-pt resting position marker**, keeping the rail aligned with the artwork and metadata. The artwork-led hierarchy and transport spacing otherwise meet the secondary gate.

7. **Detail-page dismissal chrome is inconsistent.**  
   `main-lamps.png` versus the three full-screen Dog Walk captures: close circles differ in size and vertical placement. Standardize a **72-pt circle**, **28-pt glyph**, and shared **40-pt leading / 32-pt top inset**, with page titles on the same header centerline. This is a finishing issue; Lamps’ centered instrument and room-card alignment already meet its gate.

Clock is the strongest screen: readable hands, restrained cardinal numerals, clear complication separation and a clean footer. Lamps also earns its pass through coherent instrument geometry and explicit control scope.

Stills cannot establish glass response during movement, touch targets, scrolling quality, transitions, Dynamic Type, reduced motion, or clock clearance throughout rotation. Material comments describe appearance, not implementation.

**Verdict: FAIL — six of twelve supplied prototype captures miss their gates; the absent `pages-*` modules remain unreviewed.**