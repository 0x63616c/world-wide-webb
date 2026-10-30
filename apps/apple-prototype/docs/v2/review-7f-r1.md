The layout is coherent, but material balance and control hierarchy still fall below the requested bar. Clock is the strongest screen.

Reviewed all **12 available prototype captures** against the latest applicable directions in [APPLE-SPEC.md](/tmp/www8-review-7f/APPLE-SPEC.md). The Apple references are benchmarks, not scored submissions. **No `pages-*` files are present**, so Weather, Calendar, Media, Video, Sonos Rooms and Photos full-screen pages remain unreviewed. No deductions for fixtures or licensed imagery.

| File | Score | Gate pass/fail |
|---|---:|---|
| [main-home.png](/tmp/www8-review-7f/main-home.png) | 8.2 | **Fail** — requires 9.0 |
| [main-lamps.png](/tmp/www8-review-7f/main-lamps.png) | 8.4 | **Fail** — requires 9.0 |
| [main-clock-near.png](/tmp/www8-review-7f/main-clock-near.png) | 9.0 | **Pass** |
| [main-controls.png](/tmp/www8-review-7f/main-controls.png) | 8.2 | **Fail** — requires 8.5 |
| [main-nowplaying.png](/tmp/www8-review-7f/main-nowplaying.png) | 8.8 | **Pass** |
| [main-dogwalk-tile.png](/tmp/www8-review-7f/main-dogwalk-tile.png) | 8.2 | **Fail** — requires 8.5 |
| [main-dogwalk-tile-running.png](/tmp/www8-review-7f/main-dogwalk-tile-running.png) | 8.3 | **Fail** — requires 8.5 |
| [main-dogwalk-full.png](/tmp/www8-review-7f/main-dogwalk-full.png) | 8.5 | **Pass** |
| [main-dogwalk-full-running.png](/tmp/www8-review-7f/main-dogwalk-full-running.png) | 8.6 | **Pass** |
| [main-dogwalk-remote.png](/tmp/www8-review-7f/main-dogwalk-remote.png) | 8.6 | **Pass** |
| [main-iphone-home.png](/tmp/www8-review-7f/main-iphone-home.png) | 8.1 | **Fail** — requires 9.0 |
| [main-iphone-home-bottom.png](/tmp/www8-review-7f/main-iphone-home-bottom.png) | 7.9 | **Fail** — requires 9.0 |

Both iPhone captures use the specification’s explicit **9.0 Home gate**.

Worst-first flaws follow. Dimensions below are proposed corrections in logical points.

1. **`main-iphone-home-bottom.png` — visible scroll-boundary residue.** A horizontal blurred shelf remains above Music. It looks like a partially erased preceding surface and breaks the otherwise continuous wallpaper. Eliminate that residual contour; confine the content fade to the specified **8 pt**, with the preceding tile completely outside the visible region at this anchor. Preserve Music’s complete silhouette.

2. **`main-home.png`, `main-controls.png`, both Dog Walk tile captures — the material reads heavier than the composition needs.** Broad gray-brown surfaces and persistent perimeter lines make the board feel like a collection of smoked panels. The photograph remains busy in the gutters while becoming almost unreadable through the largest controls. Keep the **24-pt grid**, but soften the wallpaper’s fine detail—approximately **6-pt blur** is a useful starting correction—and tune the native material against that backdrop. Keep inactive surfaces neutral and warm tint confined to lighting state. Do not add drawn highlights or outlines. This is a criticism of the visible result, not a claim that the glass implementation is fake.

3. **`main-iphone-home.png` — the brightness glyph overwhelms its instrument.** The black sun nearly touches the white-fill boundary at the displayed 65%, making the fader look cramped despite the tall surrounding card. Reduce the glyph to **28–32 pt**, position it comfortably inside the lower fill, and preserve approximately **16 pt** of clearance at this state. Retain the generous slider target and the clearly separated “3 of 8 on” count.

4. **`main-controls.png`, `main-dogwalk-tile.png`, `main-dogwalk-tile-running.png` — destination and command affordances are uneven.** Walk clearly separates History from Start/End; Cameras and Photos rely entirely on recognizing the whole card as navigation. Media adds a footer link, producing a third convention. Add a consistent **20-pt disclosure chevron** to destination headers, aligned to the **32-pt trailing inset**. Keep the green **72-pt** Walk action exclusive to starting or ending the walk.

5. **`main-lamps.png` — the active room competes with the main instrument.** The large ivory Bedroom surface attracts almost as much attention as the luminous brightness fill. Its active state is clear, but the screen has two competing bright masses. Preserve the light active treatment and dark text while reducing its warm cast and luminance through the native material. Tighten the central stack to roughly **16 pt between value and count**, then **24 pt between count and fader**. Keep the existing equal room-card widths and **64-pt** side gaps; those alignments work.

6. **`main-home.png` — the Lamps helper has excessive hierarchy.** “Adjusting turns all 8 on” becomes a conspicuous two-line instruction alongside the actual state. Reduce it from the specified **20 pt to 17–18 pt secondary**, retaining **16 pt** separation from the count. Keep percentage and count primary. The thermostat’s large value already establishes the correct main emphasis; this supporting instruction should recede.

7. **`main-nowplaying.png` — seek looks less actionable than volume.** The timeline appears as a passive progress line, while volume has an unmistakable thumb. Add a restrained **10–12-pt seek thumb**, retaining a **44-pt interaction region**, and place time labels approximately **16 pt below the track**. Artwork, transport spacing and the coordinated background are otherwise convincing.

8. **`main-clock-near.png` — minor complication typography remains.** The percent unit inside the car ring is noticeably weak beside “78.” Increase it to **18–20 pt**, keeping its baseline optically aligned with the number. Preserve the dial, corner clearance and footer alignment: these are the most resolved elements in the submission.

The full-screen Walk states earn their passes through clear typography, stable panel positions and explicit device origin. Their black content background also gives the chart and history a cleaner hierarchy than the photographic dashboard.

Stills cannot establish glass behavior in motion, actual hit regions, scrolling quality, accessibility, synchronization or hand clearance throughout a complete rotation. Native material provenance cannot be certified visually.

**Verdict: FAIL — 7 of 12 supplied captures miss their gates, and the six requested full-screen module pages lack review evidence.**