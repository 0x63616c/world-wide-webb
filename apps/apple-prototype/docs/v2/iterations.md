iter-1: 7.5/10 — Nine large complications and a dominant thin Climate value now read as a face; the vertical Lamps control is clear and honestly global. Three internal render/review passes, final captures only. Type and spacing are much closer; calm teal wallpaper and bright amber-glyph ON states work, but the glass still lacks the reference's optical depth.

Still off:
- Glass: highlights are restrained and tinted; the surfaces remain flatter than calum_3's reflected/refracted edges. ON tiles are a little too milky.
- Wallpaper: calm as requested, but its broad blurred shapes lose much of the reference's dimensional character.
- Spacing: the pager still leaves slightly unequal top/bottom outer margins; gutters are equal, and all nine tiles remain large. Climate has more empty middle space than the reference.
- Lamps: the member captions feel less resolved than the main slider and group buttons; the amber field is somewhat flat.
- Overall: recognizably Apple-inspired in hierarchy, SF type and controls, not yet indistinguishable from the reference's material finish.

iter-1 (orchestrator review): 6.5/10. Big, readable, and the right type hierarchy, but it is still a 9-tile app grid rather than a watch-style face with complications. Fixes for iter-2:
- Fewer, larger complications.
- Climate numerals should be Regular/Medium weight like the ref's "68", not ultralight.
- Wallpaper is now too empty: bring back the ref's large, faint geometric teal shapes.
- The cyan rim stroke looks cheap: use a white specular edge plus a deeper shadow.
- The Lamps member captions are too small.

iter-2: 7.2/10 — Six-complication Home and larger type read well; Lamps and Music are spacious. Clock glyphs clip from negative tracking, alarm tick spacing is uneven, and native glass still reads cyan at its rim. All seven requested renders delivered, plus a labelled comparison. (render loop: 30s)

Render path: incremental WorldWideWebb-Snapshots build-for-testing + test-without-building on the already-booted iPad unit-test host; fixed ~/wwwebb-proto-dd. ImageRenderer and native drawHierarchy outputs are retained separately. A single simctl screenshot during the same test confirms the hosted Home material, including its unwanted cyan edge; no app launch tour or UI tests. PNG transfer/composition took about 90s beyond the 30s render, still under five minutes end to end.

iter-2 (orchestrator review): 7.5/10. A big step up: Home is now a 6-tile face (hero Climate, analog clock, Wi-Fi, 3 accessories) with big glyphs and names, heavier Climate numerals, faint geometric wallpaper. Now Playing is the closest yet to Apple (calum_5 feel). Clock-near reveals 4 corner complications plus the next alarm. Fixes:
- The Home analog clock is an ellipse, not a circle.
- Climate chevrons are too small and thin.
- The tile rim still reads cyan.
- The ON tile is still a bit milky.
- Clock-near numerals and hands collide with the complications.
- Clock-near "72°" vs Home "70": label it ambient vs set.
- "3 lamps on" looks inconsistent with only Bedroom being lit.
- The alarm ticks are uneven.
- Lamps is still the weakest view.

iter-2a (pre-QR intermediate, was named 2b; file iter-2a.png): 7.8/10 — Clock numerals now remain intact and the orange ring has uniform spacing. White specular highlights are stronger and ON glass is less milky; a thin native cyan bevel remains at lower edges, so one final material pass is warranted. Music, Lamps and all supported commands are intact; 12 store tests pass. (render loop: 28s)

iter-2b: 8.3/10 — Fixture-driven CoreImage Wi-Fi QR hero with a clean quiet zone; circular Home clock, bold chevrons, white/neutral specular rims and clearer ON glass. Near-clock complications have solid contrast, smaller intact numerals and an explicit Inside climate label. Shared lamp counts identify the three lit Bedroom fixtures; Lamps has larger room controls, a stronger fader and deeper amber light. Alarm ticks follow a concentric screen-edge rounded rectangle with exact arc-length spacing and longer fifth ticks. All nine scenes rendered; 19 focused unit tests pass, including QR decode round trips and corner-normal/spacing checks. The glass still has less optical depth than the reference, and the alarm pill intentionally covers part of the near-clock 6. (render loop: 31s)

iter-2b (orchestrator review): 8.0/10. The Wi-Fi QR hero is clean and correct (decoded in tests). The home clock is a true circle, chevrons are bold, rims are neutral. The alarm ring now follows the screen edge with even spacing. Remaining:
- The alarm corners are almost square (the inset kills the radius). Calum's ref is more rounded, so it may want a larger effective radius.
- Side ticks look heavier than the top/bottom ones.
- The glass still lacks depth.
- The near-clock alarm pill covers the 6.
- The whole set still reads "very good mock" rather than Apple.
This is the input to the iter-3 research pass.

iter-3 (pass 1): builder 7.5/10; independent reviewer Home 6.5, Lamps 5.5, clock-near 7.0 — FAIL. (render loop: 39s) Full review: review-3.md. Remaining: cyan glass outlines, clipped idle clock, square lamp glow, squeezed Tesla gauge label, weak weather sky, scope ambiguity and secondary-text contrast. These scores supersede prior self-scoring expectations.

iter-3b (pass 2): builder 7.8/10 — regular native glass trial, neutral Lamps field, corrected gauge and idle dial. (render loop: 45s) Independent review pending in review-3b.md; iPhone captures included.

iter-3b: 7.0/10 — independent review: Home 6.5, Lamps 7, clock-near 7.5; all below 9. See review-3b.md. Remaining: material depth, sepia cast, cloud shapes, uneven clock hierarchy, phone footer overlap, Tesla range hierarchy (render loop: 45s).

iter-3c: 7.5/10 builder — clearer glass, unclipped alarm caps, consistent detail sizing, compact phone spacing. Independent review pending (render loop: 42s).

iter-4: builder 8/10; independent reviewer Home 7.5, Lamps 8.5, clock-near 8.2 — FAIL. See review-4.md. Live simulator captures only. Mixed Home spans, system glass over licensed Luca Bravo photograph, safe-area phone pager, fixture scrubber and separate volume. 24 unit tests pass; iOS and macOS builds pass. Remaining builder findings: full-screen photo strips and artwork/control alignment.

iter-4b: builder 8.5/10; independent review pending in review-4b.md (already running externally; not restarted). Live simulator evidence archived under docs/screenshots/v4/pass-4b. Shared HomeFaceLayout frames fix touching circles and reserve the page band; unit geometry checks cover equal gutters (±0.5 pt), intersections and safe margins on iPad and iPhone. Neutral Lamps, stronger secondary text, full-bleed Clock/Music and revised player alignment.

iter-4b review: Home 8.3, Lamps 8.2, clock-near 8.8; Controls 7.8, phone Home 8.0, Music 8.1, phone Music 8.4. Geometry and bottom clearance pass. Scope clarity, room active-state consistency, secondary hierarchy and clock optical balance remain. Review completed after local pass commit.

iter-5 review: Home 8.5, Lamps 8.7, clock-near 9.0 (PASS); Home More 8.2. Calendar 8.6, Cameras 8.6 and Photos 9.0 pass 8.5; Weather 8.3, Media/video 8.0 and Sonos Rooms 8.2 fail. Phone bottom clearance passes; hard scroll edges and pager caption padding remain. Full-screen module fixes belong to the independent pages worktree. See review-5.md.

iter-5b checkpoint (b36dff3b): shared Walk Zero state, ActivityKit extension, remote-start fixture and two-device start/stop tests; all 35 tests passed before the final visual refinements. Reachability test includes every module and every round accessory on panel/phone Home pages. Final capture/review pending; review-5 clock 9.0 is retained as the prior-pass score, not reused as a 5b score.

iter-5b capture checkpoint: 18 valid live iPad captures archived, including idle/running Walk Zero, shared iPhone-origin start and the clock complication. Home/Weather use the same inspected Home-face capture after rejecting a cold-launch white frame. Geometry/reachability and timestamp/remote-state tests are included in the last confirmed 69-test suite; latest build succeeds and complete rerun follows phone capture. Independent review pending.

iter-5b review submission: all 25 live simulator captures inspected and archived. Current app build and all 81 unit tests pass (0 failures), including timestamp-derived elapsed time, cross-client remote start/stop, Home reachability, intersections, equal gutters and safe margins. Fresh read-only Astra reviewer started with only PNGs, references and APPLE-SPEC.md. Builder notes: phone scroll boundaries and Dog Walk footer still need refinement.

iter-5b review: Home 8.6, Lamps 9.0 (PASS), clock-near 8.8; More 8.5. Dog Walk tile idle 8.5/running 8.6 and Live Activity preview 8.6 pass; history idle 8.4, running/remote 7.8 and phone 6.8 fail. Phone Home 8.2/top and 8.5/end; bottom clearance passes. All 81 tests pass. Pass 5c targets native scroll bars, stronger running-time hierarchy and metadata, compact phone card proportions, Home material balance and clock complication contrast. Full-screen page findings remain with WWW-8-pages. See review-5b.md.

iter-6 checkpoint: retained pending native scroll-bar changes; xcodegen and all five project.yml scheme builds pass (macOS app has no test action). All 82 prototype tests including hosted geometry renders pass in the Snapshots scheme. The broader iPad scheme exposes stale UI assertions for the retired Home layout and old no-QR behavior; Panel tests lost their embedded test bundle when the smoke build replaced the app, and the smoke recovery assertion failed. Raw results: pass-6/checkpoint. Isolated native test verification and UI assertion updates follow in pass 6. This is a source checkpoint, not a new visual review.

iter-6 capture checkpoint: 25 validated live simulator captures saved in pass-6; owned screens copied to docs/screenshots/v6/pass-6. Updated phone card/pager proportions, Home metadata, Lamps alignment, clock footer, music clearance and Dog Walk elapsed/chart hierarchy. All 82 unit/hosted tests pass. UI checks exposed missing hit regions in the Climate header and pager; content shapes and 44-point targets are built and their interaction rerun is active. Full scheme verification and the cold review are queued behind the shared Mac simulator lock; the source commit follows those required checks.

iter-6 review checkpoint: authoritative review-6.md scores Home 8.5, Lamps 9.0, Clock 8.8, phone Home 8.3/8.1; gate FAIL. All five explicit scheme builds succeeded. Snapshots: 82 tests pass; Panel unit tests pass. iPad UI checks: 5/7 pass, with Climate navigation/mode assertions failing in the last run; Panel-Smoke rerun is queued on the shared lock. Preserve the buildable pass now, then resolve UI checks and all eight visual findings in pass 6b. No pass-6 re-review.

iter-6b source checkpoint: all five explicit schemes generated/built successfully. WorldWideWebb-iPad passed 82 unit/hosted + 7 UI tests; WorldWideWebb-Snapshots passed 82; Panel and Panel-Smoke passed. Native hybrid targets and embedded WalkActivity remain intact. HomeFaceLayoutTests pass overlap/gutter/margin/reachability checks for both faces and all phone widths. Eight review-6 fixes are implemented; mandatory live capture is queued on the shared simulator lock. Cold review pending (no reuse of pass-6 scores).

iter-6c method audit: baseline3/main-baseline-median.md arrived. The pass-6 r2 review uses Markdown-linked filenames; the original parser silently skipped all 12 rows. tools/median.py now accepts those cells and rejects incomplete/mismatched review tables; p6-median-parser-audit.md contains all three runs. Published baseline retained (including its stricter 8.8 Music value); the clock is additionally checked against the correctly parsed 8.7. tools/review3.sh now tolerates a main-only/pages-only image set and propagates reviewer failures. No prompt or score has been edited. The clock's 6b regression is addressed by the 6c 24-point glyph-clearance test; Music retains semantically correct endpoint symbols while 6c improves metadata contrast. These are candidates, not accepted changes, until the three-run comparison.

iter-6c inherited checkpoint: 323dd7cc commits the three pre-existing 6b edits after xcodegen and all five scheme builds passed; WorldWideWebb-iPad (82 unit/hosted + 7 UI), WorldWideWebb-Snapshots (82), Panel and Panel-Smoke tests passed. New 6c candidate source remains separate pending its own verification, deterministic captures and three-run review. No push/PR/merge.

iter-6c source checkpoint: xcodegen and all five scheme builds pass. Both prototype schemes pass 83 unit tests plus the hosted render test; all seven iPad UI tours, Panel unit tests and Panel-Smoke pass. ClockClearanceTests rasterizes actual SF glyphs and verifies the 24-point entire-sweep clearance at three dial sizes. First live Home/Lamps/clock captures validate and repeat exactly (MAE 0.000000/255). Builder rejected the reduced active Home tint because black labels lack contrast; a native tint correction remains pending before review. Capture queue is sharing the mini with the pages job. No candidate acceptance or gate claim.

### Pages pass 6 — 03:28 PT — awaiting review

Preserved inherited work in 596a512b, then built visual source d270affc. Pass-5 regressions (Calendar both sizes, Media both sizes, Sonos both sizes) use fix-forward changes; acceptance requires each to recover at least its best pass-4/pass-5 median in baseline3/pages-baseline-median.md. All captures use two independent fixed-clock launches, shared lock, PNG validator and destination marker; RGB diffs are retained in pages-6/determinism.tsv. Review runner bb7ac926 invokes the unchanged review3.sh/REVIEW-PROMPT-orch.txt and baseline comparison. Ancillary macOS AVKit availability fix 16f77b61 compiles successfully and changes no iOS visuals. No acceptance or READY claim yet.

### Pages pass 6 decision — gate FAIL

Three cold reviews parsed all 14 files. Five pages meet 8.5. Per-page improvements/holds are retained; regressions are rejected and being fixed forward in pass 7. No pass-wide acceptance or READY claim. Comparator: pages-review-6-comparison.md.

| File | Baseline | Pass 6 median | Decision |
|---|---:|---:|---|
| pages-calendar-full.png | 8.4 | 8.3 | reject regression; fix forward |
| pages-cameras-full.png | 8.4 | 8.5 | retain; meets gate |
| pages-iphone-calendar-full.png | 8.3 | 8.2 | reject regression; fix forward |
| pages-iphone-cameras-full.png | 8.5 | 8.4 | reject regression; fix forward |
| pages-iphone-media-full.png | 7.8 | 8.1 | retain improvement; further refinement needed |
| pages-iphone-photos-face.png | 8.4 | 8.5 | retain; meets gate |
| pages-iphone-sonos-rooms.png | 7.5 | 7.7 | retain improvement; further refinement needed |
| pages-iphone-video.png | 8.5 | 8.5 | retain; meets gate |
| pages-iphone-weather-full.png | 8.3 | 8.2 | reject regression; fix forward |
| pages-media-full.png | 8.2 | 8.4 | retain improvement; further refinement needed |
| pages-photos-face.png | 8.7 | 8.7 | retain; meets gate |
| pages-sonos-rooms.png | 8.1 | 8.1 | retain improvement; further refinement needed |
| pages-video.png | 8.5 | 8.5 | retain; meets gate |
| pages-weather-full.png | 8.5 | 8.3 | reject regression; fix forward |

Pass 7 comparison floor is baseline3/pages-after-6-median.md (per-page maximum). Calendar regressions get tighter heading/NOW spacing and primary upcoming venues; iPhone Cameras gets a quieter heading; Weather gets primary small labels, reduced redundant copy and restrained corners. The unchanged Weather implementation still regressed in this review; its earlier baseline remains the floor. Photos retains the explicitly required 16-pt attribution; only the redundant phone image-title line is removed. Headered 72-pt versus immersive 64-pt dismissal geometry is retained because Calum explicitly specified those sizes.

Pass 7 builder correction before cold review: phone Sonos showed the system scroll-edge blur stacked with the explicit 8-pt fade. Disable the automatic effect and restore a 24-pt section gap, preserving 96-pt rows and the separately pinned lock controls. Only Sonos is being recaptured on both devices; the 14-page cold review has not started.

iter-6c preflight correction: rejected a nonblank portrait/letterboxed iPad PNG that passed the generic validator. Snapshot scene readiness now pins orientation; capture setup uses Xcode 27 devicectl to set physical orientation and rejects incorrect PNG aspect ratios. Standard colour scheme, contrast and content size are pinned. Two UI failures were investigated: Climate navigation passed on rerun; the repeated Lamps switch failure led to an idempotent requested-state binding and richer assertion diagnostics. All five current builds pass; final tests and corrected captures are queued behind other jobs on the shared simulator lock. No review or acceptance claim.

Pass 7 review batching: the corrected Sonos recaptures have waited over 15 minutes for the shared simulator lock. Review the other 12 validated/deterministic screens now as pages-review-7-content, and the two corrected Sonos screens later as pages-review-7-sonos. Each screen still receives exactly three independent cold gpt-6-astra/xhigh reviews through unchanged tools/review3.sh, the fixed prompt, the same five references and APPLE-SPEC. Raw runs remain separate; the pass summary will identify each batch and combine per-screen medians without inventing combined reviewer runs or rerolling any scores. Compare both batches against baseline3/pages-after-6-median.md.

### Pages pass 7 content decision — FAIL (Sonos batch pending)

Three cold runs scored the same 12 files. Nine regressions are rejected and being corrected in pass 8. Photos on iPad and both Video screens retain accepted medians; iPad Photos is pixel-identical to pass 6, so its score movement reflects reviewer variation. Raw runs are pages-review-7-content-r[123].md.

| File | Prior floor | Pass 7 median | Decision |
|---|---:|---:|---|
| pages-calendar-full.png | 8.4 | 8.3 | reject; revert/fix forward |
| pages-cameras-full.png | 8.5 | 8.4 | reject; revert/fix forward |
| pages-iphone-calendar-full.png | 8.3 | 8.2 | reject; revert/fix forward |
| pages-iphone-cameras-full.png | 8.5 | 8.2 | reject; revert/fix forward |
| pages-iphone-media-full.png | 8.1 | 7.9 | reject; revert/fix forward |
| pages-iphone-photos-face.png | 8.5 | 8.4 | reject; revert/fix forward |
| pages-iphone-video.png | 8.5 | 8.5 | retain |
| pages-iphone-weather-full.png | 8.3 | 8.1 | reject; revert/fix forward |
| pages-media-full.png | 8.4 | 8.2 | reject; revert/fix forward |
| pages-photos-face.png | 8.7 | 8.8 | retain |
| pages-video.png | 8.5 | 8.6 | retain |
| pages-weather-full.png | 8.5 | 8.4 | reject; revert/fix forward |

iter-6c review submission (04:55 PT): all 12 final live screenshots are validated, fixed-clock double-launch pairs; maximum RGB MAE is 0.057623/255 (limit 0.5/255). The isolated directory contains only main PNGs, the same five refs and APPLE-SPEC.md. tools/review3.sh is running three cold fixed-prompt reviews. All five builds and both prototype unit/hosted suites pass; seven UI tours and hybrid checks are still running. Native active tint is corrected and all accepted captures have the required orientation. Builder flags the Dog Walk status scrim as still visually heavy. No median acceptance or gate claim yet.

iter-7 clean point: accepted 6c Home 8.5 (+0.1), Controls 8.4 (+0.2), idle Walk tile 8.4 (+0.2); ties retain their medians. Rejected clock 8.2 and restored pass-6 clock 8.6. Rejected Dog Walk detail 7.9/8.0/8.0 and restored 6b page at 8.0/8.1/8.1; removed its local scrim. Restored 6b phone bottom scroll/pager composition (8.2 floor). Remaining floors: running tile 8.3, phone Home 8.4, Lamps 8.8, Music 8.8. Deterministic clock, orientation/capture checks and idempotent switch fix retained. No new review claimed; this is a per-screen source recovery. All-scheme verification pending before commit.

### Pages pass 7 Sonos decision — reject both

Corrected, valid deterministic Sonos pair: RGB MAE 0.000000/255 on each device. Three cold reviews through unchanged tools/review3.sh. iPad median 7.8 (7.8/7.8/8.0), below pass-6 8.1 by 0.3; iPhone median 7.2 (7.2/7.1/7.2), below pass-6 7.7 by 0.5. Both rejected; SonosRoomsPage restored from d270affc in a fix-up commit before pass-8 redesign. Raw evidence: pages-review-7-sonos-r[123].md; comparator pages-review-7-sonos-comparison.md.

iter-7 clean point verification: xcodegen and all five explicit scheme builds succeeded; both prototype unit/render suites, all seven interaction tours, Panel unit tests and Panel-Smoke passed. Smoke needed most of its 40-second observation window but completed successfully. Native hybrid files unchanged. Evidence: pass-7/clean-checks/.

iter-7 candidate capture: replaced the Home composition with a nine-module grid and repeated round-action rail; paired phone information cards; centred the Lamps brightness instrument between equal room controls; replaced the clock poster numerals with a full watch-inspired dial and four corner complications. Source zoom IDs are unique per face. Layout tests cover every face and phone width; the new glyph-raster test protects 24-point hand clearance through the entire rotation. All 12 live simulator screenshots pass validation, orientation and independent double-launch determinism (maximum RGB MAE 0.002355/255, limit 0.5). Evidence stays in external pass-7/. Three unchanged-prompt cold reviews are running; acceptance and gates pending.

iter-7 candidate verification: xcodegen and all five explicit schemes build; each prototype scheme passes 83 unit tests plus its hosted render test, all seven iPad interaction tours pass, and Panel/Panel-Smoke pass. Native hybrid targets are preserved. Commit is a tested candidate checkpoint while review-7 three-run medians are pending. No full-size screenshots added to Git; no push/PR/merge.

## Pages pass 8 — 05:46 PT, rejected

| File | Median | Runs | Gate | Δ vs base |
|---|---:|---|---|---:|
| pages-calendar-full.png | 8.0 | 8.3/7.8/8.0 | fail ≥8.5 | -0.4 |
| pages-iphone-calendar-full.png | 8.1 | 8.1/8.0/8.3 | fail ≥8.5 | -0.2 |
| pages-iphone-media-full.png | 7.8 | 7.8/7.8/7.8 | fail ≥8.5 | -0.3 |
| pages-iphone-sonos-rooms.png | 7.2 | 7.0/7.2/7.2 | fail ≥8.5 | -0.5 |
| pages-iphone-weather-full.png | 7.9 | 7.9/8.0/7.7 | fail ≥8.5 | -0.4 |
| pages-media-full.png | 7.6 | 7.6/8.0/7.0 | fail ≥8.5 | -0.8 |
| pages-sonos-rooms.png | 7.7 | 8.0/7.7/7.6 | fail ≥8.5 | -0.4 |
| pages-weather-full.png | 8.2 | 8.2/8.2/8.1 | fail ≥8.5 | -0.3 |

Runs parsed: [8, 8, 8] files each.

All eight screens regress by more than 0.1. No candidate qualifies for the brief's optional refinement. Restore Calendar 1ff30187, Weather 600e92b8, Media 16f77b61, Sonos d270affc via fix-up commits 7634b5c4 and 0a5d8abf. Frozen Cameras and Photos remain their restored per-screen baselines; Video is unchanged. No accepted floor is lowered. Recapture and three-run verification of the restored state follows separately as pages-8-restored. The discarded redesign and large-text fix remain in commit history.

iter-7 median decision: Clock 8.8 (+0.2) and iPhone bottom 8.3 (+0.1) accepted. Home 8.4 (−0.1) and Lamps 8.7 (−0.1) use the explicitly permitted ONE refinement: both offer stronger instrument grouping, and review identifies concrete alignment/control fixes. Their floors remain 8.5/8.8; reject those redesigns if 7b does not recover them. iPhone Home 8.0 (−0.4) rejected: restore full-width weather/agenda composition from fdc82141, retaining the independently accepted bottom layout. Controls 8.2, idle Walk tile 8.2, running/remote Walk detail 7.9 and Music 8.7 are below floors; these screen bodies had no redesign hunks in 5da28cb8, so keep their accepted source/floors and fix the concrete contrast findings in 7b rather than claiming acceptance of the lower scores. Walk idle detail 8.0 and running tile 8.3 tie. Full table: review-7-comparison.md. Gate FAIL.

## Pages pass 8 — restored-state verification, 06:03 PT

| File | Median | Runs | Gate | Δ vs base |
|---|---:|---|---|---:|
| pages-calendar-full.png | 8.0 | 8.0/8.0/8.1 | fail ≥8.5 | -0.4 |
| pages-iphone-calendar-full.png | 7.9 | 7.7/7.9/8.0 | fail ≥8.5 | -0.4 |
| pages-iphone-media-full.png | 8.1 | 8.2/8.1/8.1 | fail ≥8.5 | +0.0 |
| pages-iphone-sonos-rooms.png | 7.8 | 7.8/7.7/7.8 | fail ≥8.5 | +0.1 |
| pages-iphone-weather-full.png | 8.0 | 8.0/8.2/7.9 | fail ≥8.5 | -0.3 |
| pages-media-full.png | 8.4 | 8.4/8.6/8.3 | fail ≥8.5 | +0.0 |
| pages-sonos-rooms.png | 8.2 | 8.2/8.3/8.2 | fail ≥8.5 | +0.1 |
| pages-weather-full.png | 8.2 | 8.3/7.9/8.2 | fail ≥8.5 | -0.3 |

Runs parsed: [8, 8, 8] files each.

The mandatory recapture/rescore is complete. All eight restored screens remain below 8.5 in this sample. Preserve the locked pass-6 floors; do not lower them or treat this verification as a new accepted design. Calendar, Weather and Sonos iPad PNGs are pixel-identical to their historical baseline captures; Media iPad differs by only 0.002394/255. Older phone Calendar/Weather evidence predates the native black screenshot mask; interior content differences are under 0.001/255. Source files match the recorded baseline commits exactly. There are no remaining redesign hunks to revert. Pass 8 has no eligible <=0.1 refinement, so the experiment ends restored, not READY. Six tests and the restored build pass. See pages-8-restored/historical-comparison.tsv.

iter-7b review preparation: moved historical score/acceptance paragraphs out of APPLE-SPEC into iterations.md; reviewers receive design requirements without prior-score anchors. Prompt, five image references and image protocol remain unchanged. Published baseline floors remain unchanged except the accepted pass-7 Clock/phone-bottom increases.

iter-7b capture: all 12 final live simulator states validate in the required orientation and pass the independent relaunch comparison; maximum RGB MAE 0.004590/255. Home/Lamps/clock are pixel-identical pairs. Final captures are in external pass-7b/. Three fixed-prompt cold runs are active in review-7b-r[123]; no medians or acceptance claimed yet. Xcodegen/all-five builds and both 83-unit-plus-render prototype suites pass; interaction/kiosk checks are completing before the local candidate commit.

iter-7b candidate verification: xcodegen and every explicit project.yml scheme build pass; both prototype schemes pass 83 unit tests plus hosted render; all seven interaction tours pass; Panel unit and Panel-Smoke pass. Entire-sweep numeral clearance remains ≥24 pt with the extended hands. Source is committed as a tested refinement candidate while the three-run median review is active. No new full-size PNGs in Git, protected pages files unchanged, no push/PR/merge.

iter-7b median decision: ACCEPT Lamps 9.0 (+0.2), Clock 9.1 (+0.3), Dog Walk history 8.5 (+0.5), running/remote detail 8.6 (+0.5 each), and running tile 8.4 (+0.1). Music 8.8 ties its floor and passes. Home 8.3 failed its ONE permitted refinement: REJECT the pass-7 Home composition and restore its pre-7 spans/content from fdc82141 before the next candidate. Controls 8.3, idle tile 8.3, phone Home 8.3 and phone bottom 8.2 are below retained floors 8.4/8.4/8.4/8.3; not accepted. Next candidate fixes the material/contrast and concrete scroll-boundary defects while preserving all passing detail bodies. No baseline lowered. Gate remains FAIL (Home, phone and More/tile states). Full results: review-7b-comparison.md.

iter-7c candidate: rejected Home redesign restored to its pre-7 seven-module spans. Trial licensed ForestPhoto backdrop and untinted regular glass; full-perimeter brightness recess, aligned More footers, explicit mixed lighting state and stronger supporting text. Phone uses one 24-pt gutter and complete Music geometry at the lower anchor. All 12 live screenshots validate in the required orientation and pass independent relaunch comparison (maximum 0.000977/255). Source hashes and determinism.tsv retained in pass-7c/. Three unchanged-prompt cold reviews are running. A faint preceding tile rim at the phone’s upper scroll boundary is recorded in inspection.md for the next correction. All five builds and both 84-unit-plus-render suites pass; final interaction/kiosk checks are finishing.

iter-7c final verification: xcodegen and all five explicit scheme builds PASS; both prototype schemes pass 84 unit tests plus hosted render; all seven UI tours PASS; Panel unit and Panel-Smoke PASS. The verification SSH wrapper ended with 143 after the smoke test, but its retrieved native log explicitly records one passing test and TEST EXECUTE SUCCEEDED at 07:14:43 PT. Earlier simulator-start failures are retained separately. This local commit records the tested candidate while three cold reviews continue; acceptance waits for medians. No screenshot binaries committed, no protected pages edits, no push/PR/merge.

iter-7c median decision: REJECT ForestPhoto material trial. Home 8.0 (-0.5), Controls/idle Walk tile 7.9 (-0.5), running tile 8.0 (-0.4), iPhone Home 8.2 (-0.2), phone bottom 7.8 (-0.5). Remove forest contamination; no floor lowered. Full Walk states tie 8.5/8.6/8.6. Clock 9.0/Lamps 8.6/Music 8.7 score lower despite unchanged view bodies and near-identical evidence (Clock exact; Lamps MAE0.000065, Music0.004590); no responsible hunks exist to revert, so retain accepted source/floors. Next pass fixes recovered Home instrument grouping, photo-tile hierarchy and the 2-pt scroll-edge remnant. See review-7c.md and comparison.

iter-7d preparation: remove rejected forest trial; use licensed, desaturated CoastPhoto with a top crop. Group panel thermostat controls, align Home photo/camera headings and leading Walk timer, fix phone boundary. Live regular/clear material comparison retains regular for text because clear loses contrast over the sky; all development captures validated. The capture readiness deadline is reduced from 300 to 90 seconds; shared lock, 45-second orientation preparation, validator and three-attempt cap remain. SSH keepalives avoid abandoned streaming connections; no unrelated process was stopped.

iter-7d final candidate: all five scheme builds PASS; both prototype schemes pass 84 unit tests and hosted render; all seven interaction tours, Panel unit and Panel-Smoke PASS. Remaining phases resumed through detached runners after an SSH reset; persisted completion status is 0. All 12 live PNGs validate and pass independent relaunch comparison (maximum 0.000744/255). Phone remnant is visually gone; layout assertions cover its clear edge strip, gutters and safe pager margin. Three fixed-prompt cold reviews are running at review-7d-r[123]. Source is committed as a tested candidate; acceptance waits for medians. No new screenshot binaries, protected pages edits, push/PR/merge.

iter-7d median decision: Pass 7d: REJECT changed Home/More/phone-top material candidate. Home 8.3, Controls/idle tile 8.1, running tile 8.2, phone Home 8.2 are below the retained floors. Phone bottom 8.3 and Music 8.8 tie. Full-screen Clock/Lamps/Walk bodies are unchanged from accepted source; their lower repeat scores (8.8/8.6/8.4/8.5/8.5) do not identify any responsible code hunk to revert. Preserve those source versions and all accepted floors. Remove CoastPhoto and the cream/charcoal tile treatment in the next candidate; retain the tested scroll-edge correction. Gate remains FAIL.

iter-7e tested candidate (08:49 PT): native clear glass over the restored licensed LakeWallpaper, restrained active tint, and phone Climate/Lamps/Ceiling/Fan grouping. Room cards tighten around the Lamps instrument. Xcodegen and all five explicit scheme builds PASS; both prototype suites pass 86 tests (85 unit plus hosted render); all seven UI tours, Panel tests and Panel-Smoke PASS. The first room-power UI tour missed the Living Room toggle; its exact rerun passes without implementation changes, and the initial failure is retained. All 12 live screenshot pairs validate; maximum MAE0.008497/255. A new frame assertion protects first-viewport phone controls in addition to gutters, reachability and pager safety. Three cold fixed-prompt reviews are running. Candidate only: floors unchanged, acceptance pending. No protected-page edits, screenshot binaries, push/PR/merge.

iter-7e median decision: REJECT the pass-7e clear-glass/strong-dimming trial: Home 8.1, Controls and both Walk tiles 8.0, phone Home 8.2 fall below their floors. Phone bottom 8.3 ties, but the shared material is reverted consistently. REVERT full Lamps to its accepted pre-7e source (9.0 floor; candidate8.6). Clock8.8 has no changed source and is pixel-identical to7b; retain accepted source/floor9.1. Music8.8 and Walk detail8.5/8.6/8.6 tie and remain accepted. No baseline lowered. Next structural candidate: wide Sonos tile; compact Weather plus Ceiling on first Home; retain tested phone control grouping while fixing target labeling.

iter-7f tested candidate (09:28 PT): restored regular glass reading surfaces and original wallpaper treatment; compact Weather plus Ceiling on Home; Sonos becomes a wide two-room summary on More. Full Lamps restored exactly to its accepted source. Phone has an explicit Target label and aligned Music/Tesla text axes. Live preflight caught numeral compression from a bounded frame; vertical fixedSize preserves the intended font. All five schemes were rebuilt from final source, both prototype suites pass 86 tests, all seven UI tours PASS, Panel and Panel-Smoke PASS. The initial preflight navigation tour missed return from Climate; the final complete suite passes without changing test expectations. All12 final live pairs validate, maxMAE0.000227/255. Three cold reviews are running; candidate acceptance pending, floors unchanged. Protected pages untouched; no full-size PNGs committed and no push/PR/merge.

iter-7f median decision: REJECT the 7f Home/More rearrangement and phone first-viewport control grouping: Home 8.2, Controls/idle Walk tile 8.2, running tile 8.3, phone Home 8.1 and bottom 7.9 all regress. Restore the accepted module arrangements and native active/inactive glass treatment before the next candidate. Full Lamps/Clock/Music source is unchanged from accepted versions; paired-image comparison with 7b is 0.000065/0/0.004590 mean RGB levels respectively, so lower repeat medians 8.4/8.8/8.7 identify no responsible source hunk. Preserve those accepted versions and floors. Walk details 8.5/8.6/8.6 tie. No baseline lowered. Gate remains FAIL.

iter-7g preflight (09:58 PT): all five scheme builds and both 87-test prototype suites pass. The new live-window geometry test fails as intended on the original TabView offset: left/right80, top67.5, bottom92.25 points. Top alignment alone does not correct it. A page-level safe-area change is queued; final captures are gated on the live-window test. The failed preflight is retained and will not be reviewed.

iter-7g live-geometry verification (10:07 PT): The final fix wraps only the fixed Home/More canvas in a top-origin GeometryReader. The original safeAreaBar and other faces are retained; the two safe-area experiments did not move the live bounds and were removed. Both Home and More now measure left/top/right80 and bottom79.75 points, within the 0.5-point test tolerance. All five final source builds pass; remaining tests and final captures are running.

iter-7g tested candidate (10:21 PT): restores accepted Home/More spans and native material after rejecting7f. The fixed canvas now uses a top-origin GeometryReader, with a live-window test proving equal80-point margins above the pager (bottom79.75). Phone removes wholly occluded glass, restores Climate/Weather/Up Next first, and scales the narrow fader symbol. All five builds, both87-test prototype suites, eight UI tours, Panel and Panel-Smoke pass. One lamp-drag endpoint failure passes on exact unchanged rerun; logs retained. All12 live pairs validate, maximum MAE0.000564/255. Three cold reviews running; floors unchanged. No protected-page edits or screenshot binaries committed.

## WWW-54 — iteration 1: Climate instrument grouping

Starting from main (`5ede6d5b`, merged WWW-8), try only the panel thermostat
portion of the 7h plan: place 64-point adjustment targets beside the 152-point
value, with the existing setpoint caption 24 points below. Preserve all module
placements, phone composition, wallpaper, native materials and full-screen pages.
The published twelve-screen floors in `baseline3/main-baseline-median.md` remain
the acceptance criteria. No new score or acceptance is claimed at this checkpoint.

Mac and iPad builds pass; the remaining schemes, tests and deterministic live
captures are running in the isolated `~/wwwebb-home-design/` and
`~/wwwebb-home-design-dd/` directories. The capture and verification harnesses now
accept explicit output/app/derived-data paths while preserving their old defaults
and the shared simulator lock. Full-resolution evidence stays outside Git.

### WWW-54 iteration 1 decision — REJECT

| File | Median | Runs | Gate | Δ vs base |
|---|---:|---|---|---:|
| main-clock-near.png | 9.0 | 8.8/9.0/9.0 | PASS ≥9.0 | -0.1 |
| main-controls.png | 8.2 | 8.0/8.2/8.2 | fail ≥8.5 | -0.2 |
| main-dogwalk-full-running.png | 8.6 | 8.6/8.7/8.6 | PASS ≥8.5 | +0.0 |
| main-dogwalk-full.png | 8.6 | 8.6/8.7/8.6 | PASS ≥8.5 | +0.1 |
| main-dogwalk-remote.png | 8.6 | 8.6/8.7/8.6 | PASS ≥8.5 | +0.0 |
| main-dogwalk-tile-running.png | 8.2 | 7.9/8.2/8.2 | fail ≥8.5 | -0.2 |
| main-dogwalk-tile.png | 8.2 | 8.0/8.2/8.2 | fail ≥8.5 | -0.2 |
| main-home.png | 8.4 | 8.2/8.4/8.4 | fail ≥9.0 | -0.1 |
| main-iphone-home-bottom.png | 8.4 | 8.4/8.5/8.2 | fail ≥8.5 | +0.1 |
| main-iphone-home.png | 8.3 | 8.3/8.4/8.2 | fail ≥9.0 | -0.1 |
| main-lamps.png | 8.7 | 8.7/8.7/8.6 | fail ≥9.0 | -0.3 |
| main-nowplaying.png | 8.8 | 8.8/8.8/8.8 | PASS ≥8.5 | +0.0 |

Runs parsed: [12, 12, 12] files each.

Home 8.4 is below its 8.5 floor; the single Climate grouping change is
reverted in a new commit. No floor is lowered. The other eleven view designs
are unchanged from main; comparison with pass 7g is exact or within
0.000448/255, so their lower repeat scores have no responsible design hunk.
This does not waive the twelve-screen acceptance rule.

All five builds, both prototype suites (149 unit tests plus hosted render each),
eight UI tours and Panel unit tests pass. The expanded Panel-Smoke suite finds
a harness mismatch: camera/alarm tests expect 1366×1024, but the prototype
simulator is 1376×1032. A separate Lights detail assertion also fails. Hybrid
verification will be repeated on an existing 12.9-inch simulator under the
shared device lock; no expectations are weakened. Twelve independent capture
pairs pass, maximum RGB MAE 0.000608/255. Raw cold reviews, captures and logs:
`/workspace/wwwebb-ui/prototype/v2/www54/iteration-1/`.

## WWW-54 — iteration 2: grouped Home accessory row

With iteration 1 reverted, test only the bottom-row part of the 7h plan. Music
occupies the two leading cells; Clock, Ceiling and Fan occupy three equal round
cells. Calendar moves to the two leading bottom cells of More. Every destination
remains reachable, and the phone solver and phone presentation remain unchanged.
Climate, Lamps, materials and wallpaper retain main's implementation. Existing
geometry and shared-state UI tests follow the moved controls without weakening
margin, gutter, reachability or state assertions. Capture and median review are
pending; no acceptance is claimed.

Iteration 2 is rejected: the first two completed cold runs score Home 8.2 and
8.3, making the three-run median mathematically below its 8.5 floor regardless
of the final run. Restore the main Home/More spans, specification and geometry
anchors in a new commit, including the Music hit-area follow-up that only served
the rejected layout. Retain the asynchronous fan-state assertion correction.
The full twelve-screen median table follows when the final cold run completes.

### WWW-54 iteration 2 final medians — REJECT

| File | Median | Runs | Gate | Δ vs base |
|---|---:|---|---|---:|
| main-clock-near.png | 8.8 | 8.8/8.8/9.0 | fail ≥9.0 | -0.3 |
| main-controls.png | 8.1 | 8.1/8.2/8.1 | fail ≥8.5 | -0.3 |
| main-dogwalk-full-running.png | 8.6 | 8.7/8.6/8.6 | PASS ≥8.5 | +0.0 |
| main-dogwalk-full.png | 8.5 | 8.6/8.5/8.4 | PASS ≥8.5 | +0.0 |
| main-dogwalk-remote.png | 8.6 | 8.7/8.6/8.6 | PASS ≥8.5 | +0.0 |
| main-dogwalk-tile-running.png | 8.2 | 8.2/8.1/8.2 | fail ≥8.5 | -0.2 |
| main-dogwalk-tile.png | 8.1 | 8.1/8.2/8.1 | fail ≥8.5 | -0.3 |
| main-home.png | 8.3 | 8.3/8.2/8.3 | fail ≥9.0 | -0.2 |
| main-iphone-home-bottom.png | 8.6 | 8.6/8.5/8.7 | PASS ≥8.5 | +0.3 |
| main-iphone-home.png | 8.5 | 8.5/8.6/8.5 | fail ≥9.0 | +0.1 |
| main-lamps.png | 8.6 | 8.6/8.6/8.5 | fail ≥9.0 | -0.4 |
| main-nowplaying.png | 8.8 | 8.7/8.8/8.8 | PASS ≥8.5 | +0.0 |

Runs parsed: [12, 12, 12] files each.

Home 8.3 is 0.2 below its floor; More and both Walk tiles also regress. The
source restoration is committed; all twelve published floors remain unchanged.
Other screen bodies are unchanged; their repeat-score movement is not accepted
as a new baseline. All twelve independent relaunch pairs pass determinism,
maximum RGB MAE 0.000564/255. Evidence:
`/workspace/wwwebb-ui/prototype/v2/www54/iteration-2/`.

All five builds and both 149-unit-plus-hosted-render prototype suites pass. Six
of eight UI tours pass; live margins expose the Music button's content-only
accessibility bounds (removed with the rejected row), and the fan toggle test
reads asynchronous feedback too early (now uses the existing value-wait helper).
Panel verification is still running. No acceptance or TestFlight claim.

## WWW-54 — iteration 3: taller Home Lamps fader

Final permitted iteration: restore main's Home/More composition, then put the
panel Lamps glyph and title on one line and give the 88-point-wide fader an
explicit 208-point height. Preserve the percentage, mixed-state explanation,
phone layout, full-screen Lamps page, Climate and materials. This tests only the
remaining instrument proportion from 7h. No acceptance claimed before review.

Iteration 3 capture checkpoint: all five scheme builds PASS. All twelve live
independent-relaunch pairs validate and pass determinism; maximum RGB MAE is
0.000627/255. Against archived pass-7g captures, the eleven non-target states
differ by at most 0.000619/255; Home changes only its Lamps instrument and
nearby material rendering. All evidence stays outside Git in
`/workspace/wwwebb-ui/prototype/v2/www54/iteration-3/`. Three cold reviews use
the unchanged prompt/script/reference hashes; transient connection retries
remain in their original logs. Final iPad unit tests pass; the rest of the
verification is running. The superseded iteration-2 Panel unit phase passed;
its slow Panel-Smoke run was interrupted to release resources for the final
candidate and is not claimed as passing. No design acceptance yet.

Iteration 3 is rejected: completed cold runs score Home 8.4 and 8.2, so its
three-run median cannot reach the 8.5 floor. Restore the main Lamps tile in a
new commit. The three-iteration cap is reached; no fourth redesign is attempted.
All main visual implementations, phone changes and published floors are
retained exactly. Final cold-run medians and verification results follow when
the remaining work completes. No design improvement or release is claimed.

### WWW-54 iteration 3 final medians — REJECT

| File | Median | Runs | Gate | Δ vs base |
|---|---:|---|---|---:|
| main-clock-near.png | 8.8 | 8.8/8.7/8.8 | fail ≥9.0 | -0.3 |
| main-controls.png | 8.1 | 8.3/8.0/8.1 | fail ≥8.5 | -0.3 |
| main-dogwalk-full-running.png | 8.6 | 8.6/8.5/8.6 | PASS ≥8.5 | +0.0 |
| main-dogwalk-full.png | 8.5 | 8.5/8.3/8.5 | PASS ≥8.5 | +0.0 |
| main-dogwalk-remote.png | 8.6 | 8.6/8.5/8.6 | PASS ≥8.5 | +0.0 |
| main-dogwalk-tile-running.png | 8.2 | 8.2/7.9/8.2 | fail ≥8.5 | -0.2 |
| main-dogwalk-tile.png | 8.1 | 8.3/8.0/8.1 | fail ≥8.5 | -0.3 |
| main-home.png | 8.2 | 8.4/8.2/8.2 | fail ≥9.0 | -0.3 |
| main-iphone-home-bottom.png | 8.6 | 8.7/8.6/8.6 | PASS ≥8.5 | +0.3 |
| main-iphone-home.png | 8.6 | 8.7/8.3/8.6 | fail ≥9.0 | +0.2 |
| main-lamps.png | 8.6 | 8.7/8.5/8.6 | fail ≥9.0 | -0.4 |
| main-nowplaying.png | 8.8 | 8.8/8.8/8.7 | PASS ≥8.5 | +0.0 |

Runs parsed: [12, 12, 12] files each.

Home 8.2 is 0.3 below its retained floor. The candidate is reverted; no
iteration qualifies for acceptance. The final visual source matches main
exactly, retaining Home's historical 8.5 floor rather than inventing a new
restored-state score. All twelve comparisons above describe the rejected
candidate. No other screen's floor changes. All three raw runs completed in
the original review processes after transient connection retries.

The rejected candidate's five builds, iPad unit suite and hosted render pass;
its remaining verification was interrupted after rejection. A fresh full
verification and deterministic Home recapture are running on the restored
source. The remaining branch changes are harness isolation, focused comparison
support, a fan feedback wait in the UI test, and this experiment log. The design
score goal remains unmet; no merge or TestFlight upload is claimed.

### WWW-54 restored verification — fixture harness follow-up

All five restored builds, both prototype unit/render suites and the full Panel
unit scheme pass. Restored Home is pixel-identical to archived main (RGB MAE
0.000000/255); its independent relaunch pair passes at 0.027648/255. Live margins
pass. The navigation tour initially misses More after dismissing Climate; its
activity trace shows Home still selected. Preserve the failure and retry the
unchanged test serially after the other tours. No assertion is weakened.

Panel-Smoke completes 10/11 cases successfully on the correct 1366×1024 device.
The multi-module case times out waiting for the detail toolbar to disappear
on returning to web, after repeated 60-second app-idle waits. Its Climate portion
alone consumes over twelve minutes while continuous decorative effects run.
Add DEBUG-only `-hybridFixtures -hybridStill`, reusing the existing `motionPhase`
environment to stop decorative fan/sky effects in functional module tours.
Provider clocks, write paths, assertions and the separate real-time alarm tests
remain unchanged. Normal/release rendering and the scored prototype are unchanged.
The affected native builds and fixture tests are being reverified. This is a
verification harness fix, not a fourth design iteration or an accepted redesign.


### WWW-54 final checkpoint — no eligible design; smoke blocked

The three allowed design iterations are complete and rejected (Home medians
8.4, 8.3, 8.2). All visual changes are reverted in new commits. Retained Home
is the historical accepted 8.5 state, pixel-identical to archived main; no new
restored-state review score or design improvement is claimed.

All five scheme builds pass. Both prototype schemes pass their unit and hosted
render suites. All eight UI tours have passing results: navigation and Lamps
power required unchanged serial retries, with the original failures retained.
Panel unit tests pass, including 94 refreshed PanelTests after the DEBUG fixture
motion change. Branch CI at 50112381 is green.

Panel-Smoke does not pass as a complete suite. The first restored run passes
10/11 cases, with the multi-module web-return idle timeout described above.
After the fixture motion fix, a full retry fails five cases with simulator
launch/automation resource errors (including “Resource temporarily unavailable”).
A further unchanged full retry stalls before its first assertion: after over
18 minutes, XCTest reports “Unable to monitor event loop” and xcodebuild is idle.
Stop only this task's stalled run; leave other sessions and global settings alone.
The unused task prototype simulator was already shut down under www8-simlock.

Raw captures, determinism checks, three cold runs per candidate and verification
logs are archived outside Git under /workspace/wwwebb-ui/prototype/v2/www54/.
No screenshot binaries are committed. The mandatory pre-PR Panel-Smoke gate is
unmet, so no PR is opened, no merge is performed and no TestFlight release is
claimed. The design goal remains unmet. Resume with a healthy shared simulator
host to finish verification; do not attempt a fourth design iteration under this
brief. The branch preserves all experiment/revert history without rewriting.


### WWW-55 candidate 1 — rejected

Cold Sol-medium medians: Controls **8.3**, idle Walk **8.3**, running Walk **8.2**
against floors **8.4/8.4/8.4**. Reject all visual hunks in `bc10831b`; retain the
review runner. Twelve deterministic relaunch pairs pass (max 0.000612/255).
No floor changes. Full per-screen medians and validation limits: [WWW-55](www-55.md).


### WWW-55 candidate 2 — rejected; retain tooling

Cold Sol-medium medians: Controls **8.3**, idle Walk **8.3**, running Walk **8.3**.
Reject all visual hunks in `bf695fd1`; no floor is lowered. Twelve fresh relaunch
pairs pass (max 0.000026/255). Final Swift/UI source matches main with WWW-64
integrated. Retained historical target medians remain **8.4/8.4/8.4**; the 8.5
goal is unmet. Ship the reproducible review runner and experiment evidence using
Refs WWW-55. Full per-screen medians: [WWW-55](www-55.md).


### WWW-55 restored-state measurement

Restored source matches main (`c87324f1`); twelve independent relaunch pairs pass
(max 0.000564/255). Fresh three-run medians: Controls **8.2**, idle Walk **8.2**,
running Walk **8.3**. Target captures match the pre-change baseline within
0.000608/255. Record the repeat measurement separately from historical accepted
floors **8.4/8.4/8.4**; no floor is lowered and no visual candidate is shipped.
PR #851 uses Refs WWW-55 and retains tooling/evidence. The 8.5 goal remains unmet.


### WWW-55 final verification — pass

All five restored-source scheme builds, both prototype unit/render suites, all
eight UI tours, the complete Panel unit scheme and all **19 Panel-Smoke tests**
pass with WWW-64 integrated. PanelKit's **70 tests** also pass. Nine cold reviews
complete across the two rejected candidates and restored set. Raw final logs are
archived off the mini; PR #851 retains only the review runner and evidence.

WWW-55 follow-up 2 (2026-10-31): rejected tall Walk / wide Sonos structural trial `87060098`; revert `d81f65d2`. Three cold Sol-medium reviews: Controls **8.2**, idle Walk **8.2**, running Walk **8.1**, versus fresh baseline **8.3/8.3/8.2** and historical floors **8.4/8.4/8.4**. All 24 double-launch capture pairs pass (max MAE 0.000572/255); all nine protected screens match fresh baseline within 0.000065/255. Home Climate untouched. Baseline/candidate iPad builds, candidate Snapshots build, 149 unit tests, repository typecheck, push hooks and candidate CI pass. Candidate is reverted; final implementation equals `eba45d82`. Docs/evidence-only branch pushed, no PR or TestFlight upload per the ticket stop rule. Full tables and screenshots: [www-55.md](www-55.md#follow-up-2--tall-walk-instrument-rejected-2026-10-31). No accepted floor changes.
