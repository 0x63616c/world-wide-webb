# Pass 7 — three cold reviews

| File | Median | Runs | Gate | Δ vs base |
|---|---:|---|---|---:|
| main-clock-near.png | 8.8 | 8.8/8.8/8.8 | fail ≥9.0 | +0.2 |
| main-controls.png | 8.2 | 8.2/8.2/8.2 | fail ≥8.5 | -0.2 |
| main-dogwalk-full-running.png | 7.9 | 7.9/7.9/8.1 | fail ≥8.5 | -0.2 |
| main-dogwalk-full.png | 8.0 | 8.0/8.0/8.0 | fail ≥8.5 | +0.0 |
| main-dogwalk-remote.png | 7.9 | 7.9/7.9/8.1 | fail ≥8.5 | -0.2 |
| main-dogwalk-tile-running.png | 8.3 | 8.3/8.3/8.4 | fail ≥8.5 | +0.0 |
| main-dogwalk-tile.png | 8.2 | 8.2/8.2/8.2 | fail ≥8.5 | -0.2 |
| main-home.png | 8.4 | 8.5/8.4/8.4 | fail ≥9.0 | -0.1 |
| main-iphone-home-bottom.png | 8.3 | 8.2/8.3/8.3 | fail ≥8.5 | +0.1 |
| main-iphone-home.png | 8.0 | 8.0/8.2/8.0 | fail ≥9.0 | -0.4 |
| main-lamps.png | 8.7 | 8.4/8.8/8.7 | fail ≥9.0 | -0.1 |
| main-nowplaying.png | 8.7 | 8.7/8.6/8.7 | PASS ≥8.5 | -0.1 |

Runs parsed: [12, 12, 12] files each.

iter-7 median decision: Clock 8.8 (+0.2) and iPhone bottom 8.3 (+0.1) accepted. Home 8.4 (−0.1) and Lamps 8.7 (−0.1) use the explicitly permitted ONE refinement: both offer stronger instrument grouping, and review identifies concrete alignment/control fixes. Their floors remain 8.5/8.8; reject those redesigns if 7b does not recover them. iPhone Home 8.0 (−0.4) rejected: restore full-width weather/agenda composition from fdc82141, retaining the independently accepted bottom layout. Controls 8.2, idle Walk tile 8.2, running/remote Walk detail 7.9 and Music 8.7 are below floors; these screen bodies had no redesign hunks in 5da28cb8, so keep their accepted source/floors and fix the concrete contrast findings in 7b rather than claiming acceptance of the lower scores. Walk idle detail 8.0 and running tile 8.3 tie. Full table: review-7-comparison.md. Gate FAIL.

Full independent findings: review-7-r1.md, review-7-r2.md, review-7-r3.md.
