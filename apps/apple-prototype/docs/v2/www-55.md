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
