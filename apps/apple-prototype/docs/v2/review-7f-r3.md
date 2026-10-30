Reviewed all **12 product screenshots** against the latest 7f spec. The five Apple references serve as calibration. **No `pages-` files are present**, so the named full-screen modules remain unassessed. Fixtures and licensed imagery incur no deductions.

Home—including iPhone Home, per the spec—requires **9.0**; Lamps and Clock require **9.0**; other captures require **8.5**.

| File | Score | Gate pass/fail |
|---|---:|---|
| [main-home.png](/tmp/www8-review-7f/main-home.png) | 8.2 | Fail |
| [main-lamps.png](/tmp/www8-review-7f/main-lamps.png) | 8.4 | Fail |
| [main-clock-near.png](/tmp/www8-review-7f/main-clock-near.png) | 8.8 | Fail |
| [main-controls.png](/tmp/www8-review-7f/main-controls.png) | 8.2 | Fail |
| [main-nowplaying.png](/tmp/www8-review-7f/main-nowplaying.png) | 8.7 | Pass |
| [main-dogwalk-tile.png](/tmp/www8-review-7f/main-dogwalk-tile.png) | 8.2 | Fail |
| [main-dogwalk-tile-running.png](/tmp/www8-review-7f/main-dogwalk-tile-running.png) | 8.3 | Fail |
| [main-dogwalk-full.png](/tmp/www8-review-7f/main-dogwalk-full.png) | 8.5 | Pass |
| [main-dogwalk-full-running.png](/tmp/www8-review-7f/main-dogwalk-full-running.png) | 8.6 | Pass |
| [main-dogwalk-remote.png](/tmp/www8-review-7f/main-dogwalk-remote.png) | 8.6 | Pass |
| [main-iphone-home.png](/tmp/www8-review-7f/main-iphone-home.png) | 8.1 | Fail |
| [main-iphone-home-bottom.png](/tmp/www8-review-7f/main-iphone-home-bottom.png) | 8.4 | Fail |

Fix these in this order. Dimensions below are proposed **pt** values.

1. **`main-home.png`, `main-iphone-home.png` — Lamps detail is poorly advertised.** Climate explicitly offers disclosure; All lamps looks like a self-contained brightness control. Add a trailing disclosure chevron to the Lamps heading: **20 pt on iPad, 16 pt on iPhone**, with a distinct header target. Preserve the fader’s separate interaction. A control panel should reveal where room-level controls live.

2. **`main-home.png`, `main-controls.png`, both Dog Walk tile captures, both iPhone captures — the material composition remains heavy.** Broad charcoal surfaces suppress most photographic detail, while exposed mountain and cabin edges remain visually assertive. The result reads more like smoked panels than the lighter material hierarchy in the references. Trial **36–40% wallpaper dimming**, retaining native regular glass and the existing **24-pt gutters**. Avoid adding surface tint or outlines to compensate. Judge whether this permits clearer foreground separation without further thickening the tiles.

3. **`main-iphone-home.png` — the brightness symbol collides with the fill boundary.** The sun’s upper ray touches the white/gray transition at 65%, making the instrument look incorrectly assembled. Reduce the symbol to **32 pt** and anchor it **16 pt above the track’s bottom**, fully inside the white fill at this state. Keep the value, track and caption on one centerline.

4. **`main-lamps.png` — the active room competes with the primary instrument.** The large near-white Bedroom surface attracts almost as much attention as the illuminated fader. Its active state is clear, but the brightness hierarchy is unbalanced. Retune the native active material toward a quieter warm neutral while retaining dark text and semantic-orange switch/glyph. Preserve the successful **224×384-pt fader**, equal **280-pt room cards** and **64-pt gaps**.

5. **`main-controls.png`, `main-dogwalk-tile.png`, `main-dogwalk-tile-running.png` — photographic text and destination links lack a consistent finish.** “2 demo feeds” crosses a comparatively bright mountain patch; History is visibly stronger than Browse library and All 5 rooms. Extend the camera’s feathered black scrim across the complete upper text band. Standardize destination links at **20-pt semibold**, retaining their **32-pt bottom inset**. The running tile communicates its state better than the idle tile.

6. **`main-clock-near.png` — excellent clearance, incomplete complication discipline.** The green charge ring competes with the green cardinal numerals, and its percent unit is disproportionately small. Restore the spec’s **white complication ring and foreground symbols**, reserving green for the cardinal numerals and seconds hand. Increase the percent unit to **20 pt**, baseline-aligned with the value. Preserve the clean dial and footer separation.

7. **`main-dogwalk-full.png`, `main-dogwalk-full-running.png`, `main-dogwalk-remote.png` — period selection is underscaled for the panel.** The 7/30-day labels are markedly smaller than surrounding chart typography despite ample control width. Use **18–20-pt medium labels** within the existing **48-pt control height**. The chart/history alignment and stable layout across states are strong; the explicit device-origin line works.

8. **`main-nowplaying.png` — seeking is visually ambiguous.** The progress bar resembles a read-only indicator, while volume visibly supplies a thumb. Give seeking a native slider affordance with an approximately **20-pt thumb** and generous interaction area. Preserve the artwork, track-information alignment and transport spacing; this is the most cohesive photographic-content detail screen.

Stills cannot establish material implementation, refraction during movement, touch targets, scrolling, transitions, accessibility behavior or cross-device synchronization. These scores assess the rendered appearance only.

**Verdict: FAIL — every 9.0-gated capture falls short, several secondary captures miss 8.5, and the absent module pages prevent complete gate certification.**