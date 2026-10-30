**The photographic glass treatment is the main blocker.** The grid is disciplined, but refraction frequently competes with the information.

Reviewed all 12 app captures against the final 7e specification. The five `refs/` images are benchmarks. No `pages-*` captures were present, so those module pages cannot be scored. Fixtures and licensed content incur no deductions. The spec explicitly gives iPhone Home the 9.0 gate.

| File | Score | Gate pass/fail |
|---|---:|---|
| [main-home.png](/tmp/www8-review-7e/main-home.png) | 8.1 | **Fail** — 9.0 |
| [main-lamps.png](/tmp/www8-review-7e/main-lamps.png) | 8.6 | **Fail** — 9.0 |
| [main-clock-near.png](/tmp/www8-review-7e/main-clock-near.png) | 8.8 | **Fail** — 9.0 |
| [main-controls.png](/tmp/www8-review-7e/main-controls.png) | 8.0 | **Fail** — 8.5 |
| [main-nowplaying.png](/tmp/www8-review-7e/main-nowplaying.png) | 8.8 | Pass — 8.5 |
| [main-dogwalk-tile.png](/tmp/www8-review-7e/main-dogwalk-tile.png) | 8.0 | **Fail** — 8.5 |
| [main-dogwalk-tile-running.png](/tmp/www8-review-7e/main-dogwalk-tile-running.png) | 8.0 | **Fail** — 8.5 |
| [main-dogwalk-full.png](/tmp/www8-review-7e/main-dogwalk-full.png) | 8.6 | Pass — 8.5 |
| [main-dogwalk-full-running.png](/tmp/www8-review-7e/main-dogwalk-full-running.png) | 8.6 | Pass — 8.5 |
| [main-dogwalk-remote.png](/tmp/www8-review-7e/main-dogwalk-remote.png) | 8.6 | Pass — 8.5 |
| [main-iphone-home.png](/tmp/www8-review-7e/main-iphone-home.png) | 8.2 | **Fail** — 9.0 |
| [main-iphone-home-bottom.png](/tmp/www8-review-7e/main-iphone-home-bottom.png) | 8.3 | **Fail** — 9.0 |

Concrete flaws, worst first. Dimensions below are proposed adjustments in points.

1. **Glass creates competing imagery behind content.**  
   `main-home.png`, `main-controls.png`, `main-dogwalk-tile.png`, `main-dogwalk-tile-running.png`, both `main-iphone-home*` captures.  
   The cabin roof cuts through Music and accessory controls; mountain contours become conspicuous ripples inside Climate and Walk. On iPhone, Fan looks particularly distorted. The Apple references maintain calmer reading areas. Keep native clear glass, but reduce fine-detail contrast in the wallpaper treatment by approximately 25–35% and adjust platform-specific crops to move rooflines away from text. Preserve the existing gutters and content geometry. Further blanket dimming alone will mostly make this murkier.

2. **The active lighting surfaces look dense and brown.**  
   `main-home.png`, `main-controls.png`, `main-dogwalk-tile.png`, `main-dogwalk-tile-running.png`, both iPhone captures.  
   Lamps and Cabinet read as opaque brown blocks beside transparent gray controls. Their explicit states work; their material relationship is less convincing. Retune the native warm treatment toward neutral charcoal with a subtler orange contribution. Keep semantic orange glyphs and white values. The final spec’s 8% tint should be reconsidered if this is its rendered result.

3. **Thermostat value and meaning need tighter grouping.**  
   `main-home.png`, `main-iphone-home.png`.  
   On iPad, “Target temperature” floats too far below the numeral. On iPhone, the target label disappears entirely, leaving two temperatures with unequal explanatory treatment. Position the iPad’s 20-pt target caption 16–24 pt below the visible numeral. Add a 13–14-pt “Target” label above the phone’s 76-pt value, retaining the 17-pt indoor-status line and 48-pt actions.

4. **The Sonos heading breaks the shared heading rhythm.**  
   `main-controls.png`, `main-dogwalk-tile.png`, `main-dogwalk-tile-running.png`.  
   “Sonos Rooms” wraps into two lines and starts above the neighboring destination headings. This makes the narrow column feel squeezed despite ample overall space. Use a single-line “Sonos” heading at 28 pt, a 24-pt speaker glyph, and the same 32-pt top inset as Cameras and Photos. Retain room names at 22 pt and states at 20 pt. The existing footer alignment is good.

5. **The running Walk tile’s origin is too subordinate.**  
   `main-dogwalk-tile-running.png`.  
   “Started on iPad” becomes small, low-emphasis text between the strong timer and History action. Origin is meaningful state information. Set it to 20 pt with a brighter semantic foreground, leaving at least 8 pt before History. Preserve the 44-pt timer, pinned footer and separate 72-pt End control.

6. **The brightness command’s consequence looks like a disabled footnote.**  
   `main-lamps.png`.  
   “Adjusting turns all 8 lamps on” is substantially dimmer than the surrounding controls, although it explains an important consequence of touching the dominant instrument. Use 20-pt primary text, or a semantic secondary treatment visually nearer light gray such as `#C7C7CC`, and place it 16–24 pt beneath the fader. The centered instrument and balanced room cards are otherwise strong.

7. **The Walk period selector is undersized typographically.**  
   `main-dogwalk-full.png`, `main-dogwalk-full-running.png`, `main-dogwalk-remote.png`.  
   “7 days / 30 days” looks miniature beside the chart heading and axis labels. Increase the labels to 17-pt medium while retaining the 48-pt control height and approximately 216-pt width. These pages earn their passes through clear hierarchy, stable state layouts and coherent chart/history alignment.

8. **Clock complications need one final optical-balancing pass.**  
   `main-clock-near.png`.  
   The thin outlined thermometer has much less presence than the filled weather and paw symbols. The battery percent sign is disproportionately small. Normalize complication symbols around a 28-pt optical height with comparable visual weight; increase `%` to 18–20 pt and center the complete value/unit group within the ring. Preserve the clear hand sweep and footer baseline.

Now Playing is the most resolved composition: artwork, metadata, timeline, transport and volume form a clear sequence without photographic interference.

Stills cannot establish native material implementation, motion quality, actual hit regions, scrolling behavior, full-rotation clock clearance, accessibility adaptations or remote synchronization.

**Verdict: FAIL — eight supplied captures miss their gates, and the absent `pages-*` captures leave the full module review incomplete.**