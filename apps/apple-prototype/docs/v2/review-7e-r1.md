**The gate fails.** The outer grids are disciplined, but Home and More lack consistent material contrast and visual hierarchy.

I reviewed all 12 app captures against the latest amendments in [APPLE-SPEC.md](/tmp/www8-review-7e/APPLE-SPEC.md). Those amendments also require **iPhone Home ≥9.0**. The five `refs/` images are comparison references, not submissions. No `pages-*.png` files were present, so the full-screen module pages remain unreviewed. Fixtures and licensed imagery incur no deduction.

| File | Score | Gate pass/fail |
|---|---:|---|
| main-home.png | 8.0 | **Fail** — ≥9.0 |
| main-controls.png | 7.8 | **Fail** — ≥8.5 |
| main-dogwalk-tile.png | 7.8 | **Fail** — ≥8.5 |
| main-dogwalk-tile-running.png | 8.0 | **Fail** — ≥8.5 |
| main-iphone-home.png | 8.1 | **Fail** — ≥9.0 |
| main-iphone-home-bottom.png | 8.0 | **Fail** — ≥9.0 |
| main-lamps.png | 8.6 | **Fail** — ≥9.0 |
| main-dogwalk-full.png | 8.5 | **Pass** — ≥8.5 |
| main-dogwalk-full-running.png | 8.6 | **Pass** — ≥8.5 |
| main-dogwalk-remote.png | 8.6 | **Pass** — ≥8.5 |
| main-nowplaying.png | 8.8 | **Pass** — ≥8.5 |
| main-clock-near.png | 9.0 | **Pass** — ≥9.0 |

Scores cover the complete visible capture; the repeated idle More screens receive the same score.

Worst-first corrections follow. Point sizes are proposed targets; recommendations that change the mandated material treatment are design revisions, not claims of implementation noncompliance.

1. **Photographic detail competes with the information.**  
   **Files:** `main-home.png`, `main-controls.png`, both `main-dogwalk-tile*.png`, both `main-iphone-home*.png`.  
   Rooflines run through Music and accessory labels; mountain detail remains conspicuous behind Walk metadata. The surfaces oscillate between smoky transparency and conspicuous refraction. Revise the clear-only treatment for text-heavy controls to **native regular glass with a neutral dark appearance**. Keep primary text white, with **32-pt panel insets and 16–24-pt compact insets**. Further global wallpaper dimming would darken the scenery without adequately controlling detail behind individual labels.

2. **Active lighting reads as brown upholstery rather than a luminous control state.**  
   **Files:** `main-home.png`, `main-controls.png`, both tile captures, both iPhone captures, `main-lamps.png`.  
   Lamps and Cabinet become large, nearly opaque brown areas beside much more transparent controls. Trial reducing the specified **8% orange tint to approximately 3–4%**, retaining semantic-orange symbols and explicit state text. The material should read as neutral charcoal with warmth; the white brightness fill should remain the strongest luminous surface.

3. **Sonos has a cramped internal composition despite the accurate outer grid.**  
   **Files:** `main-controls.png`, `main-dogwalk-tile.png`, `main-dogwalk-tile-running.png`.  
   The wrapped heading, deeply inset room list and narrow metadata column make the tall card feel squeezed. Establish a **32-pt internal leading edge** shared by heading, room names and footer. Use a **24-pt speaker symbol**, a single-line **28-pt “Rooms” heading**, and subordinate **20-pt “Sonos” context**. Keep room names at **22 pt**, states at **20 pt**, and use consistent **8-pt name/state spacing**.

4. **Walk’s originating-device line is visually underpowered.**  
   **File:** `main-dogwalk-tile-running.png`.  
   “Started on iPad” is noticeably smaller and weaker than surrounding metadata, while History sits immediately beneath it. Set the origin to **20-pt primary text**, preserve the **44-pt timer**, and provide at least **8 pt of visible separation** before History. Retain the shared **32-pt leading and bottom insets**. The device origin is meaningful state information, not a footnote.

5. **The consequential brightness instruction recedes too far.**  
   **Files:** `main-lamps.png`, `main-home.png`, `main-iphone-home.png`.  
   “Adjusting turns all 8 lamps on” explains a scope change, yet the detail page presents it as faint ancillary copy. Use **20-pt primary text on iPad / 14-pt primary on iPhone**, positioned **16 pt below the fader**. On Home, give the helper a stable two-line measure and consistent spacing from “3 of 8 on.” The central instrument and room-card alignment are otherwise strong.

6. **Dog Walk’s range selector has phone-scale lettering inside a panel-scale control.**  
   **Files:** `main-dogwalk-full.png`, `main-dogwalk-full-running.png`, `main-dogwalk-remote.png`.  
   “7 days / 30 days” is disproportionately small beside the chart heading, axes and history text. Increase it to **20-pt medium**, retaining the **48-pt control height**. Slightly strengthen the secondary foreground used for timestamps and “Scroll for more.” The stable panel geometry across idle, local and remote states deserves credit.

7. **The room-selection command is less clear than the rest of Now Playing.**  
   **File:** `main-nowplaying.png`.  
   The isolated upper-right speaker cluster requires interpretation. Replace it with an approximately **128×64-pt native glass “Rooms” control**, using a **24-pt symbol and 20-pt medium label**, vertically aligned with the Home control. Artwork, track information, scrubber and transport otherwise form a coherent hierarchy.

8. **The clock has only minor remaining typographic imbalance.**  
   **File:** `main-clock-near.png`.  
   The percentage unit is noticeably diminutive inside the charge complication. Increase it to **18-pt medium**, with approximately **6–8 pt separation** from the value. Preserve the dial, restrained palette and complication clearance: this is the most resolved composition in the set.

Stills cannot verify motion, touch targets, scrolling, state synchronization, accessibility behavior or hand clearance throughout rotation. They also cannot establish how glass was implemented; the material criticism concerns its visible result.

**Verdict: FAIL — 7 of 12 supplied app captures miss their gates, and the absent full-screen module captures prevent complete coverage.**