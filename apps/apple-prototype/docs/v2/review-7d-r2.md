The required screens fall short of 9.0. The grid is largely disciplined; material weight and competing emphasis are the main weaknesses.

Reviewed all **12 prototype screenshots** against the latest amendments in [APPLE-SPEC.md](/tmp/www8-review-7d/APPLE-SPEC.md). The five `refs/` images are benchmarks, not gated submissions. **No `pages-*` screenshots are present**, so those modules remain unreviewed. The spec explicitly gives both iPhone Home captures a **9.0** gate. No deductions for fixtures or licensed imagery.

| File | Score | Gate pass/fail |
|---|---:|---|
| [main-home.png](/tmp/www8-review-7d/main-home.png) | 8.3 | **Fail** — 9.0 |
| [main-lamps.png](/tmp/www8-review-7d/main-lamps.png) | 8.7 | **Fail** — 9.0 |
| [main-clock-near.png](/tmp/www8-review-7d/main-clock-near.png) | 8.7 | **Fail** — 9.0 |
| [main-controls.png](/tmp/www8-review-7d/main-controls.png) | 8.2 | **Fail** — 8.5 |
| [main-dogwalk-tile.png](/tmp/www8-review-7d/main-dogwalk-tile.png) | 8.2 | **Fail** — 8.5 |
| [main-dogwalk-tile-running.png](/tmp/www8-review-7d/main-dogwalk-tile-running.png) | 8.3 | **Fail** — 8.5 |
| [main-dogwalk-full.png](/tmp/www8-review-7d/main-dogwalk-full.png) | 8.4 | **Fail** — 8.5 |
| [main-dogwalk-full-running.png](/tmp/www8-review-7d/main-dogwalk-full-running.png) | 8.5 | **Pass** — 8.5 |
| [main-dogwalk-remote.png](/tmp/www8-review-7d/main-dogwalk-remote.png) | 8.5 | **Pass** — 8.5 |
| [main-iphone-home.png](/tmp/www8-review-7d/main-iphone-home.png) | 8.5 | **Fail** — 9.0 |
| [main-iphone-home-bottom.png](/tmp/www8-review-7d/main-iphone-home-bottom.png) | 8.3 | **Fail** — 9.0 |
| [main-nowplaying.png](/tmp/www8-review-7d/main-nowplaying.png) | 8.7 | **Pass** — 8.5 |

Concrete flaws, worst first. Dimensions below are proposed refinements in **pt**, not claimed Apple requirements.

1. **Heavy surface treatment weakens the whole Home family.**  
   `main-home.png`, `main-controls.png`, both `main-dogwalk-tile` captures and both iPhone captures: broad brown/navy interiors and continuous coloured perimeter highlights make the controls read as heavy panels. The supplied Control Center reference has more convincing separation between wallpaper and control material. Trial wallpaper saturation around **55–60%**, down from the specified 75%, while retaining native regular glass. Evaluate the resulting surface neutrality before changing opacity; adding blur would further flatten the composition.

2. **Home’s brightest object competes with its intended hero.**  
   `main-home.png`: the tall cream Lamps tile attracts attention before Climate. Its lamp glyph, percentage, fader, count and explanatory sentence create five competing stops. Reduce the lamp symbol to **48 pt**, keep the percentage prominent, and make the **20-pt helper** a secondary dark foreground. Reduce the native warm tint’s visual intensity so the white fader remains the tile’s brightest element.

3. **More lacks a consistent internal hierarchy.**  
   `main-controls.png`, `main-dogwalk-tile.png`, `main-dogwalk-tile-running.png`: Sonos room names compete with the module heading, while camera metadata crosses detailed mountain imagery. Set Sonos’s heading to **24-pt semibold**, room names to **22-pt medium**, and states to **20-pt secondary**, using consistent **8-pt name/state gaps**. Strengthen the camera’s local upper text scrim—trial **35–40% black**, feathered across roughly **96 pt**—while preserving the photograph elsewhere.

4. **Compact accessory typography is visibly inconsistent.**  
   `main-iphone-home-bottom.png`: “Some on” has more visual weight than neighbouring “On” and “Tap to join.” This makes equivalent status information appear to have different importance. Standardize circular-control titles at **17-pt semibold** and states at **14-pt regular**, with shared title/state baselines and an **8-pt gap**. The full Music contour and pager clearance are successful.

5. **Idle Walk spends its strongest typography repeating the subject.**  
   `main-dogwalk-full.png`, `main-dogwalk-tile.png`, `main-controls.png`: “Walk Zero” followed by “Zero’s walks” gives the name more prominence than the useful last-walk information. In the full page’s existing **144-pt status region**, promote **“3h ago” to 44-pt rounded** with a **20-pt “Last walk” label** and subordinate duration. Preserve the stable statistics/panel positions demonstrated by the running captures.

6. **Clock complication emphasis is uneven.**  
   `main-clock-near.png`: the charge ring is substantially louder than the other corner complications; green is repeated across almost every peripheral symbol. Restore the spec’s **white complication symbols and charge arc**, reserving green for cardinal numerals and the seconds hand. Reduce the ring to approximately **88 pt**, with a **4-pt stroke** and **18-pt percent unit**. Preserve the aligned lower captions and clear hand sweep.

7. **Lamps still has two competing luminous surfaces.**  
   `main-lamps.png`: the large cream Bedroom card rivals the white brightness instrument. Keep its explicit orange/on treatment, but soften the native warm tint until the fader is clearly dominant. Also normalize its dismissal control with Walk: a **72-pt circle**, **32-pt symbol**, and a shared header centre around **68 pt** from the top. The current differing button sizes and vertical positions weaken cross-screen polish.

8. **Walk’s period selector is underscaled for the surrounding interface.**  
   `main-dogwalk-full.png`, `main-dogwalk-full-running.png`, `main-dogwalk-remote.png`: “7 days / 30 days” looks miniature beside the chart heading and statistics. Use **20-pt medium labels** within the existing **48-pt control**. Give the current day an explicit **“Today”** axis label. Clarify the weekly statistic with a subordinate date range so “This week” and the rolling seven-day chart are immediately distinguishable.

9. **Now Playing’s seek affordance is weaker than its volume affordance.**  
   `main-nowplaying.png`: the timeline reads as a progress indicator, while volume visibly advertises dragging. Add a restrained **10–12-pt seek thumb**, retain a **4-pt track**, and provide a **44-pt interaction region**. Artwork alignment, transport spacing and the reserved footer are otherwise the strongest composition here.

Stills establish geometry, visible contrast and hierarchy. They cannot certify native Liquid Glass implementation, moving refraction, actual touch targets, scrolling, transitions, accessibility behaviour, synchronization or clock clearance throughout rotation.

**Verdict: FAIL — 3 of 12 supplied captures pass; every required 9.0 screen falls short, and the missing module pages remain unverified.**