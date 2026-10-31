# WWW-55 — Controls and Walk tile review

The accepted source starts at `db92211f`. The historical Controls, idle Walk
and running Walk floors are 8.4 each. The target is 8.5 each, preserving every
other screen's accepted floor from external `baseline3/main-baseline-median.md`.

## Method

Use deterministic live-compositor captures with `-snapshot`, independent relaunch
pairs, shared simulator locking, readiness/PNG/orientation validation and an
RGB MAE limit of 0.5/255. The prototype canvas is 1376×1032 points; the separate
hybrid Panel schemes use a 1366×1024-point simulator. Clock/phase audit confirms
these fixture views use `store.now` and the injected motion phase.

`bash scripts/review-design.sh <review-input> <out-base> <protocol-dir> <baseline>`
uses the exact external `REVIEW-PROMPT-orch.txt` and `tools/median.py`, with three
independent cold reviews. WWW-55 explicitly requires `gpt-6.1-sol` at medium;
this is the only review setting changed from the external `review3.sh`'s Astra
xhigh invocation. The runner hashes the prompt, parser, spec and every image.
References stay external. Raw evidence is archived under
`/workspace/wwwebb-ui/prototype/v2/www55/`.

## Candidate 1 — rejected

`2c855bce` reduced wide-card heading differences, separated idle recency/duration,
and led with the running timer. All twelve relaunch pairs pass; maximum MAE
0.000612/255. Fresh baseline target pairs also pass (maximum 0.000601/255).

| File | Median | Runs | Gate | Δ vs base |
|---|---:|---|---|---:|
| main-clock-near.png | 9.0 | 8.8/9.0/9.0 | PASS ≥9.0 | -0.1 |
| main-controls.png | 8.3 | 8.1/8.4/8.3 | fail ≥8.5 | -0.1 |
| main-dogwalk-full-running.png | 8.5 | 8.5/8.6/8.5 | PASS ≥8.5 | -0.1 |
| main-dogwalk-full.png | 8.6 | 8.5/8.6/8.6 | PASS ≥8.5 | +0.1 |
| main-dogwalk-remote.png | 8.5 | 8.5/8.6/8.5 | PASS ≥8.5 | -0.1 |
| main-dogwalk-tile-running.png | 8.2 | 8.1/8.4/8.2 | fail ≥8.5 | -0.2 |
| main-dogwalk-tile.png | 8.3 | 8.1/8.4/8.3 | fail ≥8.5 | -0.1 |
| main-home.png | 8.3 | 8.3/8.4/8.2 | fail ≥9.0 | -0.2 |
| main-iphone-home-bottom.png | 8.4 | 8.4/8.6/8.4 | fail ≥8.5 | -0.1 |
| main-iphone-home.png | 8.3 | 8.3/8.6/8.3 | fail ≥9.0 | -0.3 |
| main-lamps.png | 8.4 | 8.4/8.7/8.3 | fail ≥9.0 | -0.6 |
| main-nowplaying.png | 8.7 | 8.7/8.8/8.7 | PASS ≥8.5 | -0.1 |

Runs parsed: [12, 12, 12] files each.

Controls 8.3, idle Walk 8.3 and running Walk 8.2 fall below their 8.4 floors.
Reject the entire visual candidate in `bc10831b`. Protected screens also receive
lower repeat scores; their visual source is unchanged and their archived-image
MAE is at most 0.000075/255. No historical floor is lowered and no protected-screen
improvement is claimed.

All five schemes build. Both prototype unit/render suites and the first three UI
tours pass. Stop the remaining candidate-1 verification after design rejection;
those partial results do not certify the final source. An initial verification
invocation used an invalid Panel simulator ID; retain it as failed setup evidence
and use the correct existing 1366×1024 simulator for subsequent runs.

## Candidate 2 — rejected; accepted source restored

`e6b20e69` gave idle duration and running elapsed equal numeric emphasis, aligned
Media's leading heading/bottom action with Walk and strengthened caption bands.
All twelve fresh relaunch pairs pass; maximum MAE 0.000026/255.

| File | Median | Runs | Gate | Δ vs base |
|---|---:|---|---|---:|
| main-clock-near.png | 8.8 | 8.7/8.8/8.8 | fail ≥9.0 | -0.3 |
| main-controls.png | 8.3 | 8.4/8.3/8.3 | fail ≥8.5 | -0.1 |
| main-dogwalk-full-running.png | 8.5 | 8.5/8.5/8.6 | PASS ≥8.5 | -0.1 |
| main-dogwalk-full.png | 8.6 | 8.5/8.6/8.6 | PASS ≥8.5 | +0.1 |
| main-dogwalk-remote.png | 8.5 | 8.5/8.5/8.6 | PASS ≥8.5 | -0.1 |
| main-dogwalk-tile-running.png | 8.3 | 8.4/8.3/8.2 | fail ≥8.5 | -0.1 |
| main-dogwalk-tile.png | 8.3 | 8.4/8.3/8.3 | fail ≥8.5 | -0.1 |
| main-home.png | 8.3 | 8.3/8.2/8.3 | fail ≥9.0 | -0.2 |
| main-iphone-home-bottom.png | 8.4 | 8.4/8.5/8.4 | fail ≥8.5 | -0.1 |
| main-iphone-home.png | 8.4 | 8.3/8.4/8.4 | fail ≥9.0 | -0.2 |
| main-lamps.png | 8.4 | 8.1/8.5/8.4 | fail ≥9.0 | -0.6 |
| main-nowplaying.png | 8.7 | 8.7/8.7/8.7 | PASS ≥8.5 | -0.1 |

Runs parsed: [12, 12, 12] files each.

All three target medians are **8.3**, below their **8.4** floors. Reject the
entire visual candidate in `bf695fd1`. Protected images differ from archived
accepted captures by at most 0.000075/255. No baseline is lowered.

The final Swift/UI source is identical to main after integrating WWW-64
(`c87324f1`). `HomeLaunch.swift` has no WWW-55 diff. Retained accepted medians are
**Controls 8.4 / idle Walk 8.4 / running Walk 8.4**; these are historical accepted
scores, not a new restored-state review. The 8.5 goal remains unmet.

The focused delivery retains the Sol-medium review runner, input hash manifests
and the experiment record. Before/after screenshots show the retained source and
the explicitly rejected second candidate; no candidate UI is shipped.

Final verification below runs against the restored source plus WWW-64; candidate-only
partial test results do not certify it.

## Fresh restored-state review

Twelve fresh restored relaunch pairs pass (maximum MAE 0.000564/255). Target
images match the fresh pre-change baseline within 0.000608/255. Run the same
three cold Sol-medium reviews on this restored set, without candidate spec text:

| File | Median | Runs | Gate | Δ vs base |
|---|---:|---|---|---:|
| main-clock-near.png | 8.8 | 8.8/8.8/8.7 | fail ≥9.0 | -0.3 |
| main-controls.png | 8.2 | 8.3/8.2/8.2 | fail ≥8.5 | -0.2 |
| main-dogwalk-full-running.png | 8.6 | 8.6/8.5/8.6 | PASS ≥8.5 | +0.0 |
| main-dogwalk-full.png | 8.6 | 8.6/8.5/8.6 | PASS ≥8.5 | +0.1 |
| main-dogwalk-remote.png | 8.6 | 8.6/8.5/8.6 | PASS ≥8.5 | +0.0 |
| main-dogwalk-tile-running.png | 8.3 | 8.3/8.2/8.3 | fail ≥8.5 | -0.1 |
| main-dogwalk-tile.png | 8.2 | 8.3/8.2/8.2 | fail ≥8.5 | -0.2 |
| main-home.png | 8.3 | 8.3/8.3/8.3 | fail ≥9.0 | -0.2 |
| main-iphone-home-bottom.png | 8.5 | 8.6/8.4/8.5 | PASS ≥8.5 | +0.0 |
| main-iphone-home.png | 8.3 | 8.5/8.3/8.3 | fail ≥9.0 | -0.3 |
| main-lamps.png | 8.4 | 8.5/8.4/8.4 | fail ≥9.0 | -0.6 |
| main-nowplaying.png | 8.7 | 8.8/8.7/8.7 | PASS ≥8.5 | -0.1 |

Runs parsed: [12, 12, 12] files each.

Fresh final target medians are **Controls 8.2 / idle Walk 8.2 / running Walk 8.3**.
These are repeat measurements of the unchanged accepted design, not accepted
replacement floors. Historical target floors remain **8.4/8.4/8.4**. The final
source has no visual change to accept; no floor is lowered and the goal remains
unmet. The screenshot comparison and source identity distinguish review
variation from a shipped regression.

## Final verification — PASS

`bash scripts/verify-schemes.sh final-verification`, using the isolated source
mirror/derived data and the correct per-product simulator destinations, passes:

- All five scheme builds (macOS, iPad, Snapshots, Panel and Panel-Smoke).
- Both prototype schemes: 149 unit tests and one hosted-render test each.
- All eight prototype UI tours, including live margins, paging/shared state,
  Lamps, Wi-Fi and remote Walk stop.
- The complete Panel unit scheme.
- Panel-Smoke: all 19 UI tests, zero failures, including WWW-64's return flow.

`swift test --jobs 2` in PanelKit passes all 70 tests across six suites. The
review runner completes all nine cold runs across two candidates and the restored
set; each median table contains twelve screens. Shell syntax, missing-baseline
preflight, diff checks and push lint/dead-code hooks pass.

Raw final build/test logs are archived off the mini at
`/workspace/wwwebb-ui/prototype/v2/www55/final-verification-logs.tar.gz`; the
associated `.xcresult` bundles remain in the task's Mac derived-data directories.
No visual design change is shipped. The fresh final target medians remain
**8.2/8.2/8.3**, against unchanged historical floors **8.4/8.4/8.4**.
