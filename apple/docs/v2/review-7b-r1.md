Reviewed the screenshots against the latest superseding directions in [APPLE-SPEC.md](/tmp/www8-review-7b/APPLE-SPEC.md), without inspecting code. No deductions for fixtures or licensed imagery.

Every supplied prototype capture is scored below; the five Apple references are comparison material. **No `pages-*` files are present**, so the full-screen module pages cannot be assessed. Home—including both iPhone captures—requires 9.0; other thresholds follow your brief.

| File | Score | Gate pass/fail |
|---|---:|---|
| [main-home.png](/tmp/www8-review-7b/main-home.png) | 8.2 | Fail — 9.0 |
| [main-lamps.png](/tmp/www8-review-7b/main-lamps.png) | 8.6 | Fail — 9.0 |
| [main-clock-near.png](/tmp/www8-review-7b/main-clock-near.png) | 8.8 | Fail — 9.0 |
| [main-controls.png](/tmp/www8-review-7b/main-controls.png) | 8.2 | Fail — 8.5 |
| [main-nowplaying.png](/tmp/www8-review-7b/main-nowplaying.png) | 8.7 | Pass — 8.5 |
| [main-dogwalk-tile.png](/tmp/www8-review-7b/main-dogwalk-tile.png) | 8.2 | Fail — 8.5 |
| [main-dogwalk-tile-running.png](/tmp/www8-review-7b/main-dogwalk-tile-running.png) | 8.3 | Fail — 8.5 |
| [main-dogwalk-full.png](/tmp/www8-review-7b/main-dogwalk-full.png) | 8.4 | Fail — 8.5 |
| [main-dogwalk-full-running.png](/tmp/www8-review-7b/main-dogwalk-full-running.png) | 8.6 | Pass — 8.5 |
| [main-dogwalk-remote.png](/tmp/www8-review-7b/main-dogwalk-remote.png) | 8.6 | Pass — 8.5 |
| [main-iphone-home.png](/tmp/www8-review-7b/main-iphone-home.png) | 8.3 | Fail — 9.0 |
| [main-iphone-home-bottom.png](/tmp/www8-review-7b/main-iphone-home-bottom.png) | 8.0 | Fail — 9.0 |

Worst-first findings and fixes. Dimensions below are proposed adjustments in points, not claims about Apple requirements.

1. **`main-iphone-home-bottom.png`, `main-iphone-home.png`: the scroll boundaries look unfinished.** Music ends in a conspicuous horizontal, softened shelf in the bottom capture; the initial capture leaves a hairline fragment of the next card above the pager. Preserve the 80-pt pager band, confine the fade to 8 pt, and show either a meaningful card preview of at least 24 pt or no fragment. For the captured bottom position, give Music enough top clearance to preserve its rounded contour.

2. **`main-home.png`: the brightness instrument loses its outline inside the active tile.** Its white fill sits against approximately `#FFF5ED`—roughly 1.1:1 contrast—so the lower portion nearly disappears. Expose a continuous neutral-charcoal material recess around the fill with a 4-pt inset. Keep the warm active surface, but render the 20-pt instruction in a darker secondary foreground rather than giving it the same emphasis as the lamp count. This control needs a clearer silhouette before the screen merits 9.0.

3. **`main-controls.png`, `main-dogwalk-tile.png`, `main-dogwalk-tile-running.png`: surface and text hierarchy remain too uniform.** Room names, playback states, device origin and navigation links all approach the same white emphasis; the large gray surfaces read as heavy slabs. Keep primary names white, use legible semantic secondary text for 20-pt metadata, and maintain 8-pt name/status spacing. Camera captions also sit across roof and landscape detail: strengthen a localized bottom scrim over approximately 64 pt, with 32-pt caption insets. Judge the material adjustment in the compositor; adding brighter outlines would worsen it.

4. **`main-dogwalk-tile-running.png`: the timer is crowded by competing labels.** “Walk Zero,” “Elapsed,” the timer, device origin and “History” form four strong reading lines within one short tile. Make the timer 44-pt rounded monospaced, reduce “Elapsed” to 18-pt secondary, and keep origin at 20-pt secondary. Preserve the pinned title/history positions and the separate 72-pt End action.

5. **`main-dogwalk-full.png`, `main-dogwalk-full-running.png`, `main-dogwalk-remote.png`: the status-region typography is not fully stable.** The idle last-walk line sits approximately 24 pt above the running origin line, despite the stationary statistics and panels. Pin those secondary lines to one baseline inside the existing 144-pt region. The 7/30-day labels are also undersized relative to the surrounding interface: use 18-pt medium text within the existing 48-pt control. The running and remote states otherwise communicate their status clearly.

6. **`main-lamps.png`: the central hierarchy is over-separated and too uniformly emphatic.** Heading, percentage, count, instruction and effects action read as successive standalone statements. Keep the 112-pt percentage dominant; use 20-pt secondary styling for the count and instruction, with approximately 16 pt between value and count and 24 pt before the fader. Preserve the correctly centered room cards and their 64-pt instrument gaps. The geometry is stronger than the information hierarchy.

7. **`main-nowplaying.png`: the seek control looks passive.** Volume has an unmistakable handle; playback position looks like a progress indicator. Give seeking a restrained 10–12-pt visible handle and at least a 44-pt interaction region. Keep the shared artwork/text/track edges—the alignment is already convincing.

8. **`main-clock-near.png`: the remaining weakness is optical consistency.** The outlined thermometer looks fragile beside the filled weather and paw symbols; the seconds hand is similarly hairline at wall-viewing distance. Normalize complication symbols to approximately 32-pt optical footprints with consistent perceived weight, increase the seconds stroke to 1.5–2 pt, and enlarge the battery percent unit to 20 pt. Preserve the clear numeral/complication separation and footer baseline.

Stills establish composition and visible contrast, but cannot verify native Liquid Glass implementation, refraction during interaction, hit regions, scrolling behavior, motion, or hand clearance throughout a complete rotation.

**Verdict: FAIL — nine of twelve supplied prototype captures miss their gates, and the absent module pages remain unreviewed.**