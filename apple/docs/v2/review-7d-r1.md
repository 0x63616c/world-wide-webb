**The compositions are coherent, but the core screens do not reach 9.0-level finish.** The remaining weaknesses are visual hierarchy, material weight and action clarity.

Reviewed all 12 app captures against the latest applicable sections of [APPLE-SPEC.md](/tmp/www8-review-7d/APPLE-SPEC.md). Apple references serve as benchmarks. No `pages-*` files were supplied, so those modules remain unreviewed. No deductions for fixtures or licensed imagery.

Home includes both iPhone captures at the spec’s **9.0** gate. Scores cover each complete screenshot.

| File | Score | Gate pass/fail |
|---|---:|---|
| main-home.png | 8.3 | **FAIL** — 9.0 |
| main-lamps.png | 8.2 | **FAIL** — 9.0 |
| main-clock-near.png | 8.8 | **FAIL** — 9.0 |
| main-controls.png | 8.1 | **FAIL** — 8.5 |
| main-nowplaying.png | 8.8 | PASS — 8.5 |
| main-dogwalk-full.png | 8.4 | **FAIL** — 8.5 |
| main-dogwalk-full-running.png | 8.5 | PASS — 8.5 |
| main-dogwalk-remote.png | 8.5 | PASS — 8.5 |
| main-dogwalk-tile.png | 8.1 | **FAIL** — 8.5 |
| main-dogwalk-tile-running.png | 8.2 | **FAIL** — 8.5 |
| main-iphone-home.png | 8.2 | **FAIL** — 9.0 |
| main-iphone-home-bottom.png | 8.4 | **FAIL** — 9.0 |

Worst-first findings follow. Point sizes are proposed refinements; some revise choices currently prescribed by the spec.

1. **main-iphone-home.png — The first viewport looks finished before important controls appear.** Calendar ends neatly above the substantial pager, with no visible suggestion that Lamps and more controls continue below. Horizontal pagination is apparent; vertical continuation is not. Reduce Climate from **240 to approximately 216 pt**, preserving the **76-pt value and 48-pt targets**, and recover another **8 pt** from header spacing. Expose approximately **24–32 pt** of the next module above the reserved pager.

2. **main-home.png — Surface brightness competes with the intended information hierarchy.** The tall ivory Lamps panel attracts attention before Climate’s much larger instrument. Meanwhile, the dark panels read as broad brown/charcoal masses with perimeter highlights; their material character is less convincing than their geometry. Preserve the **24-pt gutters and existing spans**, but reduce the active panel’s visual luminance and warm tint through native material treatment. Keep **semantic orange** concentrated in the lamp symbol. Make the repeated “Set to 70°” caption **20-pt secondary**, leaving the setpoint and current temperature as distinct information ranks.

3. **main-lamps.png — The active room card becomes a second brightness instrument.** Its large ivory area competes with the white fader, while the room information itself is sparse. Keep the **224 × 384-pt fader**, **280-pt room widths** and **64-pt gaps**, but tighten both room cards to approximately **216 pt high**, centred on the fader. Use identical internal baselines and **24-pt row spacing**. Reduce the active card’s visual weight while retaining the orange switch, warm state treatment and explicit “On.” Bring the global-scope instruction to **16 pt below** the fader.

4. **main-controls.png, main-dogwalk-tile.png, main-dogwalk-tile-running.png — Too many elements claim headline status.** Cameras, Photos, Walk Zero and Media all announce themselves at nearly the same strength; the bright Cabinet circle adds another focal point. Keep **32-pt** type for the actionable Walk heading, reduce secondary destination headings to **28 pt**, and align their symbol boxes and text starts consistently within the **32-pt insets**. Photos also needs a calmer text zone: strengthen the local feathered black scrim behind its heading and caption, starting around **40% opacity at the text edge**, without darkening the entire photograph.

5. **main-controls.png, main-dogwalk-tile.png, main-dogwalk-tile-running.png, main-iphone-home-bottom.png — Navigation and immediate commands share insufficiently differentiated shapes.** Cabinet, Guest Wi-Fi and All lights look like equivalent circular buttons despite different consequences. The lightning bolt also suggests electrical power more readily than a lighting group. Use a **32-pt grouped-light symbol** for All lights. Give destinations a consistent **16-pt disclosure cue**; separate immediate power commands into clearly identifiable **44-pt minimum targets**. Preserve explicit “Some on” status.

6. **main-dogwalk-full.png, main-dogwalk-full-running.png, main-dogwalk-remote.png — The statistics lack visible time-scope precision, and history spends too much space per entry.** “This week,” the trailing seven-day chart and “Average per walk” invite comparison without identifying their different windows. Add **18–20-pt secondary date/scope labels** beside the relevant headings. Reduce history rows from **96 to 80 pt** and tighten the title-to-list gap to **24 pt** so more history is immediately useful. In the idle capture, reduce “Zero’s walks” to **36 pt**: its oversized repetition of the navigation title adds little. The running and remote states have the stronger hierarchy.

7. **main-clock-near.png — The dial is strong; complication styling is less disciplined.** Green numerals, seconds hand, peripheral symbols and charge ring distribute the accent across almost everything. Follow the spec’s monochrome complication treatment: **white symbols and charge ring**, green reserved for cardinal numerals and seconds. The charge percentage unit is also noticeably undersized; use an **18–20-pt percent sign** beside a **36-pt rounded value**, optically centred as one group. Preserve the clear hand sweep and shared footer baseline.

8. **main-nowplaying.png — The room-selection action is under-explained.** The isolated speaker/group symbol requires interpretation, particularly when “Living Room” already appears centrally. Replace that circle with a restrained native-glass control labelled **“Rooms”**, using a **24-pt symbol, 20-pt label and approximately 120 × 64-pt frame**. The artwork, scrubber, transport and volume hierarchy otherwise justify its passing score.

Stills cannot establish dynamic glass quality, motion, actual hit regions, scrolling behaviour, seeking, remote synchronisation or full-rotation hand clearance. I have not treated those unverified behaviours as defects.

**Verdict: FAIL — Home, Lamps and clock-near all miss 9.0, several other captures miss their gates, and the absent `pages-*` screens cannot be certified.**