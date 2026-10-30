# Pass 7c — rejected material trial

| File | Median | Runs | Gate | Δ vs base |
|---|---:|---|---|---:|
| main-clock-near.png | 9.0 | 9.0/8.7/9.0 | PASS ≥9.0 | -0.1 |
| main-controls.png | 7.9 | 7.9/7.9/8.0 | fail ≥8.5 | -0.5 |
| main-dogwalk-full-running.png | 8.6 | 8.6/8.5/8.6 | PASS ≥8.5 | +0.0 |
| main-dogwalk-full.png | 8.5 | 8.6/8.4/8.5 | PASS ≥8.5 | +0.0 |
| main-dogwalk-remote.png | 8.6 | 8.6/8.5/8.6 | PASS ≥8.5 | +0.0 |
| main-dogwalk-tile-running.png | 8.0 | 8.0/8.0/8.1 | fail ≥8.5 | -0.4 |
| main-dogwalk-tile.png | 7.9 | 7.9/7.9/8.0 | fail ≥8.5 | -0.5 |
| main-home.png | 8.0 | 8.0/8.0/8.0 | fail ≥9.0 | -0.5 |
| main-iphone-home-bottom.png | 7.8 | 7.8/7.4/7.9 | fail ≥8.5 | -0.5 |
| main-iphone-home.png | 8.2 | 8.2/7.9/8.2 | fail ≥9.0 | -0.2 |
| main-lamps.png | 8.6 | 8.7/8.6/8.6 | fail ≥9.0 | -0.4 |
| main-nowplaying.png | 8.7 | 8.8/8.7/8.7 | PASS ≥8.5 | -0.1 |

Runs parsed: [12, 12, 12] files each.


The ForestPhoto backdrop regresses Home, More, both tile states and both phone captures; remove it. No accepted baseline is lowered. Keep the existing seven-module recovery and concrete accessibility/geometry corrections for the next candidate, but they are not accepted at these medians. The next pass removes the forest cast, groups the panel thermostat controls, aligns the photo tile hierarchy, and clears the phone’s preceding-tile remnant.

Full-screen Walk states tie their accepted medians. Clock is pixel-identical to pass 7b, Lamps differs by only 0.000065/255, Music by 0.004590/255, and Walk by <0.000004/255; none of those view bodies changed. There are no new full-screen redesign hunks to revert. Retain their accepted sources and published floors (Clock 9.1, Lamps 9.0, Music 8.8, Walk 8.5/8.6/8.6), and do not claim the lower sample as a new accepted baseline.

All 12 PNGs are live validated simulator captures, independently relaunched twice; maximum pair difference 0.000977/255. All five schemes build; 84 unit tests plus render pass under both prototype schemes, seven UI tours and the native Panel/Panel-Smoke tests pass. Candidate commit: 3bb83d73. No full-size PNGs committed. No push/PR/merge.
