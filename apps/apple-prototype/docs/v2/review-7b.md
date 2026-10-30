# Pass 7b — three cold reviews

| File | Median | Runs | Gate | Δ vs base |
|---|---:|---|---|---:|
| main-clock-near.png | 9.1 | 8.8/9.1/9.1 | PASS ≥9.0 | +0.3 |
| main-controls.png | 8.3 | 8.2/8.3/8.3 | fail ≥8.5 | -0.1 |
| main-dogwalk-full-running.png | 8.6 | 8.6/8.7/8.6 | PASS ≥8.5 | +0.5 |
| main-dogwalk-full.png | 8.5 | 8.4/8.6/8.5 | PASS ≥8.5 | +0.5 |
| main-dogwalk-remote.png | 8.6 | 8.6/8.7/8.6 | PASS ≥8.5 | +0.5 |
| main-dogwalk-tile-running.png | 8.4 | 8.3/8.4/8.4 | fail ≥8.5 | +0.1 |
| main-dogwalk-tile.png | 8.3 | 8.2/8.3/8.3 | fail ≥8.5 | -0.1 |
| main-home.png | 8.3 | 8.2/8.4/8.3 | fail ≥9.0 | -0.2 |
| main-iphone-home-bottom.png | 8.2 | 8.0/8.2/8.4 | fail ≥8.5 | -0.1 |
| main-iphone-home.png | 8.3 | 8.3/8.3/8.3 | fail ≥9.0 | -0.1 |
| main-lamps.png | 9.0 | 8.6/9.0/9.0 | PASS ≥9.0 | +0.2 |
| main-nowplaying.png | 8.8 | 8.7/8.8/8.8 | PASS ≥8.5 | +0.0 |

Runs parsed: [12, 12, 12] files each.

iter-7b median decision: ACCEPT Lamps 9.0 (+0.2), Clock 9.1 (+0.3), Dog Walk history 8.5 (+0.5), running/remote detail 8.6 (+0.5 each), and running tile 8.4 (+0.1). Music 8.8 ties its floor and passes. Home 8.3 failed its ONE permitted refinement: REJECT the pass-7 Home composition and restore its pre-7 spans/content from fdc82141 before the next candidate. Controls 8.3, idle tile 8.3, phone Home 8.3 and phone bottom 8.2 are below retained floors 8.4/8.4/8.4/8.3; not accepted. Next candidate fixes the material/contrast and concrete scroll-boundary defects while preserving all passing detail bodies. No baseline lowered. Gate remains FAIL (Home, phone and More/tile states). Full results: review-7b-comparison.md.

Full independent findings: review-7b-r1.md, review-7b-r2.md, review-7b-r3.md.
