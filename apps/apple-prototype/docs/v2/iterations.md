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
