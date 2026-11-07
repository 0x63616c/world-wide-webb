**The gate fails.** The layouts are orderly and mostly legible, but material balance, information priority and compact-screen finishing fall short of the requested standard.

I reviewed all **12 prototype captures** against the latest applicable instructions in [APPLE-SPEC.md](/tmp/www8-review-7f/APPLE-SPEC.md). The five `refs/` images serve as references, not prototype gate candidates. No `pages-*` files were supplied; those module pages remain unassessed. Fixtures incur no deduction.

| File | Score | Gate pass/fail |
|---|---:|---|
| [main-clock-near.png](/tmp/www8-review-7f/main-clock-near.png) | 8.8 | Fail — requires 9.0 |
| [main-controls.png](/tmp/www8-review-7f/main-controls.png) | 8.0 | Fail — requires 8.5 |
| [main-dogwalk-full-running.png](/tmp/www8-review-7f/main-dogwalk-full-running.png) | 8.6 | Pass |
| [main-dogwalk-full.png](/tmp/www8-review-7f/main-dogwalk-full.png) | 8.3 | Fail — requires 8.5 |
| [main-dogwalk-remote.png](/tmp/www8-review-7f/main-dogwalk-remote.png) | 8.6 | Pass |
| [main-dogwalk-tile-running.png](/tmp/www8-review-7f/main-dogwalk-tile-running.png) | 8.2 | Fail — requires 8.5 |
| [main-dogwalk-tile.png](/tmp/www8-review-7f/main-dogwalk-tile.png) | 8.0 | Fail — requires 8.5 |
| [main-home.png](/tmp/www8-review-7f/main-home.png) | 8.2 | Fail — requires 9.0 |
| [main-iphone-home-bottom.png](/tmp/www8-review-7f/main-iphone-home-bottom.png) | 7.6 | Fail — requires 9.0 |
| [main-iphone-home.png](/tmp/www8-review-7f/main-iphone-home.png) | 7.9 | Fail — requires 9.0 |
| [main-lamps.png](/tmp/www8-review-7f/main-lamps.png) | 8.4 | Fail — requires 9.0 |
| [main-nowplaying.png](/tmp/www8-review-7f/main-nowplaying.png) | 8.7 | Pass |

Both iPhone Home captures receive the spec’s explicit 9.0 Home gate.

Worst-first fixes follow. Dimensions are proposed design targets, not claims about hidden implementation.

1. **`main-iphone-home-bottom.png` — an unfinished scroll boundary.** A faint, broad horizontal remnant remains above Music, inside an otherwise empty wallpaper band. It looks like an outgoing surface that never fully disappeared. Clip the departing tile and its material/shadow together; confine the fade to the specified **8 pt**. At the bottom anchor, show uninterrupted wallpaper above Music’s complete contour.

2. **`main-iphone-home.png` — the brightness symbol overwhelms its control.** The black sun nearly fills the fader’s width, and its upper ray touches the white/gray fill boundary. Reduce it to **28–32 pt**, anchor it **16 pt above the control’s bottom**, and maintain **12 pt clearance** from the fill boundary in this captured state. The panel-sized symbol has not been optically adapted to the phone.

3. **`main-home.png`, `main-controls.png`, both dog-walk tile captures, both iPhone captures — the material/background balance is too heavy.** Large gray/brown surfaces sit against conspicuous mountains, trees and cabin edges. The grid is sound, but the overall impression is bulky and visually restless. Keep the **24 pt gutters** and native regular glass; trial wallpaper dimming at **38%** and saturation around **75%**, preserving the photographs inside content tiles. Tune the material against that quieter backdrop. The visible result needs refinement; these stills do not establish that the glass implementation is incorrect.

4. **`main-controls.png`, `main-dogwalk-tile.png`, `main-dogwalk-tile-running.png` — secondary information receives excessive emphasis.** “2 demo feeds” and “3 photos” compete with the actual scene captions; Media’s generic description also carries considerable weight. Use **28 pt semibold destination headings**, **20 pt secondary counts/descriptions**, and **24 pt primary scene captions**. Keep the **32 pt content insets** and common footer baseline. Preserve the running walk’s useful **44 pt timer** and separate **72 pt action**.

5. **`main-lamps.png` — active-state brightness pulls the composition sideways.** The nearly white Bedroom card competes with the central brightness instrument, while the inactive room almost disappears. The state distinction is clear, but the visual balance is crude. Retain the **280 pt room cards**, **224 pt fader** and **64 pt gaps**; soften the active material toward a quieter warm cream through native tint/material treatment. Keep its dark text and semantic-orange switch. Reduce the effects action to **64 pt high** so it remains secondary to the instrument.

6. **`main-home.png` — current and target temperatures require an unnecessarily long visual scan.** “Inside 72° · Cooling” sits near the heading, detached from the large setpoint. Group current status and the target caption beneath the instrument using **20–24 pt text**, **8 pt between lines**, and **24 pt separation from the value**. Preserve the **152 pt setpoint** and balanced minus/plus row.

7. **`main-dogwalk-full.png`, `main-dogwalk-full-running.png`, `main-dogwalk-remote.png` — the lower analytics outweigh the status region.** Seven broad luminous bars dominate the page; idle also repeats the identity through “Walk Zero” and the oversized “Zero’s walks.” Reduce the idle headline to **36 pt semibold** within the existing **144 pt allocation**. Trial **56 pt bars** in the seven-day chart with a single semantic-green fill. Preserve the stationary panels, aligned statistics and explicit device origin—the active states handle those well.

8. **`main-clock-near.png` — complication hierarchy is inconsistent.** Temperatures communicate useful values first, but the dog complication prioritizes the familiar name over elapsed time. The charge ring’s percent unit is disproportionately small. Promote **“3h ago” to 36 pt rounded**, retain **“Zero” at 20 pt**, and set the charge unit to **18–20 pt** beside a **36 pt value**. Preserve the black field, clear hand sweep and aligned footer; those are the strongest craft here.

9. **`main-nowplaying.png` — secondary typography needs its final hierarchy pass.** Spotify and the artist remain bright enough to compete with their adjacent primary labels. Use semantic secondary foreground for those lines, keeping the **32 pt semibold track title** and time/volume values primary. Preserve the **440 pt artwork** and shared artwork/text/scrubber edges. This is the most cohesive content page.

Stills cannot verify glass refraction in motion, touch targets, scrolling behavior, transitions, Dynamic Type, reduced-motion handling or clock clearance throughout a full rotation. These are visual scores, not interaction certification.

**Verdict: FAIL — 3 of 12 supplied prototype captures pass; all required 9.0 surfaces remain below gate, and the missing module captures prevent complete certification.**