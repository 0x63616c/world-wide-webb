**The prototype does not pass.** The outer grid is disciplined, but material appearance, control grouping, and several finishing details fall below the requested standard.

I applied the latest APPLE-SPEC.md amendments, including **9.0 for iPhone Home**. All 17 supplied images are scored below; Apple references are calibration material and do not enter the gate. **No `pages-*` captures were present**, so those full-screen modules remain unreviewed. No deductions for fixtures or licensed imagery.

| File | Score | Gate pass/fail |
|---|---:|---|
| [main-home.png](/tmp/www8-review-7c/main-home.png) | 8.0 | Fail · 9.0 |
| [main-lamps.png](/tmp/www8-review-7c/main-lamps.png) | 8.6 | Fail · 9.0 |
| [main-clock-near.png](/tmp/www8-review-7c/main-clock-near.png) | 8.7 | Fail · 9.0 |
| [main-controls.png](/tmp/www8-review-7c/main-controls.png) | 7.9 | Fail · 8.5 |
| [main-dogwalk-tile.png](/tmp/www8-review-7c/main-dogwalk-tile.png) | 7.9 | Fail · 8.5 |
| [main-dogwalk-tile-running.png](/tmp/www8-review-7c/main-dogwalk-tile-running.png) | 8.0 | Fail · 8.5 |
| [main-dogwalk-full.png](/tmp/www8-review-7c/main-dogwalk-full.png) | 8.4 | Fail · 8.5 |
| [main-dogwalk-full-running.png](/tmp/www8-review-7c/main-dogwalk-full-running.png) | 8.5 | Pass · 8.5 |
| [main-dogwalk-remote.png](/tmp/www8-review-7c/main-dogwalk-remote.png) | 8.5 | Pass · 8.5 |
| [main-iphone-home.png](/tmp/www8-review-7c/main-iphone-home.png) | 7.9 | Fail · 9.0 |
| [main-iphone-home-bottom.png](/tmp/www8-review-7c/main-iphone-home-bottom.png) | 7.4 | Fail · 9.0 |
| [main-nowplaying.png](/tmp/www8-review-7c/main-nowplaying.png) | 8.7 | Pass · 8.5 |
| [refs/apple-music.png](/tmp/www8-review-7c/refs/apple-music.png) | 9.2 | N/A · reference |
| [refs/apple-weather.png](/tmp/www8-review-7c/refs/apple-weather.png) | 9.2 | N/A · reference |
| [refs/ipad-control-center-26-0.png](/tmp/www8-review-7c/refs/ipad-control-center-26-0.png) | 8.9 | N/A · reference |
| [refs/ipad-home-26-2.png](/tmp/www8-review-7c/refs/ipad-home-26-2.png) | 8.8 | N/A · reference |
| [refs/watch-infograph.png](/tmp/www8-review-7c/refs/watch-infograph.png) | 9.4 | N/A · reference |

Worst-first fixes follow. Sizes are proposed **pt** values, not measurements inferred from the Apple reference images.

1. **`main-iphone-home-bottom.png`: an orphaned tile edge survives above Music.** The thin curved highlight floating near the top looks like a clipping defect. Make the preceding tile disappear as a complete surface, including its material boundary. Preserve Music’s complete contour and a clean 24-pt gap; keep any fade confined to the specified 8-pt edge region.

2. **`main-home.png`, `main-controls.png`, both Dog Walk tile captures, both iPhone captures: the forest overwhelms the material palette.** Inactive surfaces read as muddy olive/brown slabs, with yellowish contours; the large tree trunks remain strong competing shapes. Text is mostly readable, but the surfaces lack the neutral clarity of the supplied Control Center reference. Trial approximately 25–35% less wallpaper saturation and tune the native regular material toward neutral charcoal. Reserve warm tint for active lighting. Preserve the existing 24-pt gutters; adding stronger outlines would worsen the result.

3. **Both iPhone captures: navigation chrome is too prominent for four anonymous dots.** The 200×56-pt brown capsule reads as another substantial control, yet provides little destination information. Preserve the 80-pt reservation and four 44-pt targets, but reduce the backing’s brown coloration and edge prominence. Use approximately 6-pt visual dots with a clearer selected/unselected distinction. This needs material refinement, not smaller touch targets.

4. **`main-home.png`: the thermostat’s controls are visually detached from its value.** The large `70°` occupies one zone while minus, a repeated setpoint, and plus form another near the bottom. Bring the 64-pt minus/plus targets onto the value’s horizontal centerline; use a roughly 160–176-pt value that fits that row. Place the 20-pt setpoint caption 16 pt below. The phone composition already demonstrates the stronger grouping. In the Lamps tile, retain the 8-pt surround but soften its dark contrast: it currently resembles a heavy outline around a switch.

5. **`main-controls.png`, `main-dogwalk-tile.png`, `main-dogwalk-tile-running.png`: shared tile boundaries conceal inconsistent internal hierarchy.** Cameras and Walk use prominent headings; Photos uses a much smaller footer title; Media starts its heading beside vertically centered artwork. Establish 32-pt principal headings, 20-pt metadata, and consistent 32-pt content insets. Keep the aligned footer links. In the running Walk tile, move “Elapsed” above the 44-pt timer with an 8-pt gap instead of attaching the small label to its baseline; retain the pinned title, origin, History link, and 72-pt action.

6. **`main-dogwalk-full.png`, `main-dogwalk-full-running.png`, `main-dogwalk-remote.png`: the period selector is typographically undersized.** Its small labels look lost inside a large pill beside the substantial chart heading. Use 18–20-pt semibold labels within the existing 48-pt control height. History also spends considerable space displaying only three entries: trial 80-pt rows and move the walk count into the heading area, retaining 20-pt timestamps and a visible scroll affordance. The idle page additionally repeats “Walk Zero” and “Zero’s walks”; reduce the latter to a 36–40-pt status heading. The running and remote compositions have clearer hierarchy.

7. **`main-lamps.png`: the central instrument is clear, but too many supporting elements claim similar emphasis.** “Global brightness,” the partial-on count, the full sentence below the fader, and the large effects action create a long vertical chain. Keep the 224×384-pt instrument and balanced room cards. Set the count and helper to 20-pt secondary foreground, use 16–24-pt vertical intervals, and make the effects action 64 pt high with a 20-pt label. Preserve its explicit global scope. This is refinement of an otherwise sound composition.

8. **`main-clock-near.png`: readable, but the dial lacks the reference’s precision.** The minute hand ends well inside the minute track, minor ticks recede strongly, and the charge ring carries disproportionate peripheral weight. Rebalance the numeral band and hand length together: trial 56-pt cardinal numerals, an 8-pt outward shift, and a 16-pt longer minute hand, subject to the required 24-pt clearance throughout rotation. Use approximately 1.5-pt minor ticks in a brighter neutral gray. Reduce the charge ring toward 88 pt with a 40-pt value, preserving the lower complication baseline.

9. **`main-lamps.png`, all full-screen Dog Walk captures, `main-nowplaying.png`: navigation geometry drifts between screens.** Upper-left control size and placement vary visibly. Standardize a 72-pt control frame at 48-pt leading and 40-pt top insets, with titles sharing its vertical centerline. Now Playing’s artwork, information, scrubber, transport, and volume form the strongest sequence here; its remaining clarity issue is the unexplained upper-right speaker glyph. A 20-pt “Rooms” label would clarify its destination.

Stills cannot establish live glass refraction, motion quality, touch-target behavior, scrolling quality, Dynamic Type, or clock clearance throughout rotation. The scores assess the visible result; they do not certify implementation.

**Gate verdict: FAIL — all four 9.0-gated views fall short, several other captures miss 8.5, and the `pages-*` evidence is missing.**