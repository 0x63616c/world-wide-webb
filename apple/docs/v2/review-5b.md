**Overall: FAIL. Home: 8.6 — does not clear 9. Lamps: 9.0 — clears 9. Clock-near: 8.8 — does not clear 9.**

I inspected all 25 simulator captures, the relevant Calum, Apple Home, Control Center and Watch references, and [APPLE-SPEC.md](/tmp/www8-review-5b/APPLE-SPEC.md), applying the iteration 4/4b, pass 5 and pass 5b overrides. These are visual scores for live simulator screenshots. The licensed imagery, simulated camera feeds and explicitly labelled Live Activity preview are accepted as authorized.

The table scores complete captures. Home’s 9-point target also applies to its phone captures; More and the new module/state captures use 8.5. Now Playing has no separately named numerical gate in the spec.

| Capture | Score /10 | Gate | Result |
|---|---:|---:|---|
| `sim-home.png` — Home | **8.6** | 9 | **FAIL** |
| `sim-weather.png` — Home with Weather tile | **8.6** | 9 | **FAIL** |
| `sim-lamps.png` | **9.0** | 9 | **PASS** |
| `sim-clock-near.png` | **8.8** | 9 | **FAIL** |
| `sim-controls.png` — Home · More | **8.5** | 8.5 | **PASS** |
| `sim-dogwalk-tile.png` — idle | **8.5** | 8.5 | **PASS** |
| `sim-dogwalk-tile-running.png` | **8.6** | 8.5 | **PASS** |
| `sim-dogwalk-full.png` — idle history | **8.4** | 8.5 | **FAIL** |
| `sim-dogwalk-full-running.png` | **7.8** | 8.5 | **FAIL** |
| `sim-dogwalk-remote.png` — iPhone start viewed on iPad | **7.8** | 8.5 | **FAIL** |
| `sim-calendar-full.png` | **8.4** | 8.5 | **FAIL** |
| `sim-weather-full.png` | **8.2** | 8.5 | **FAIL** |
| `sim-cameras-full.png` | **8.6** | 8.5 | **PASS** |
| `sim-media-full.png` | **8.3** | 8.5 | **FAIL** |
| `sim-sonos-rooms.png` | **8.1** | 8.5 | **FAIL** |
| `sim-photos-face.png` | **9.1** | 8.5 | **PASS** |
| `sim-video.png` | **7.7** | 8.5 | **FAIL** |
| `sim-nowplaying.png` | **8.6** | — | No separate gate |
| `sim-iphone-home.png` | **8.2** | 9 | **FAIL** |
| `sim-iphone-home-bottom.png` | **8.5** | 9 | **FAIL** |
| `sim-iphone-more.png` | **8.2** | 8.5 | **FAIL** |
| `sim-iphone-more-bottom.png` | **8.5** | 8.5 | **PASS** |
| `sim-iphone-dogwalk.png` | **6.8** | 8.5 | **FAIL** |
| `sim-iphone-liveactivity.png` | **8.6** | 8.5 | **PASS** |
| `sim-iphone-nowplaying.png` | **8.8** | — | No separate gate |

Concrete flaws, worst first:

1. **Phone Dog Walk has an actual content collision.** “Fixture data” is superimposed on the chart’s bars and plotting area. This directly violates the discreet, separate provenance treatment. The oversized close button, substantial top vacancy, repeated “Walk Zero”/“Zero’s walks” headings and generous intervening gaps push the chart below halfway down the viewport. The page spends too much of its initial screen on navigation and headings. This is the clearest failure in the set.

2. **The video presentation wastes a substantial portion of its own sheet.** A landscape film sits inside an almost square black container; roughly two-fifths of the container height becomes black space above and below the image. The close control and title occupy a disproportionately tall upper area. Preserve the film’s aspect ratio, but size the presentation around it. The still does not establish whether playback controls are available, so their absence here receives no functional deduction.

3. **Running Dog Walk history prioritizes historical statistics over the current activity.** In both local and remote captures, elapsed time is buried in a gray subtitle while **133**, **34** and **8** dominate. “Started on iPhone · 12:04” visually reads like a start time, although the intended value is elapsed duration. Give elapsed time its own prominent, explicitly labelled treatment and subordinate the originating device. The tile communicates the running state better than the full-screen destination.

4. **Sonos grouping is visually ambiguous.** Living Room ends with “Desk,” while Desk ends with “Group.” The screen does not clearly express the relationship between those two rows. The small speech-bubble-like grouping symbol further weakens recognition. Playing rows and paused rows otherwise look almost identical; the track subtitle does most of the differentiation. This needs clearer visible group membership and playback-state hierarchy, regardless of how the commands work.

5. **Secondary text loses too much contrast on several photographic pages.** Calendar’s date, Dog Walk’s status/statistic labels, Media’s descriptions and Weather’s hourly labels are conspicuously weaker than their surrounding primary text. Approximate screenshot samples put Calendar’s date around **2:1**, the running-walk subtitle around **2.6:1**, and an hourly Weather label around **2.4:1** against nearby backgrounds. These are local estimates, but the weakness is visible without measurement. Hierarchy should not require concentrating to read useful information.

6. **The phone boards remain visually oversized for their information density.** Climate, Cameras and Walk Zero use large rounded surfaces with substantial empty interiors. On More, Cameras and the idle walk tile consume most of the initial content area. Compared with the retained Apple Home phone reference, considerably less information is available at a glance. The extreme corner curvature also makes the cards feel inflated rather than precisely fitted to their contents.

7. **Weather’s full-screen composition is unresolved horizontally.** The twelve-hour forecast stops well before the right edge of the metric row, leaving an unexplained empty strip. The current temperature and condition are pushed to opposite extremes with a very broad vacant center. The four metrics form a coherent group; the forecast underneath does not share that group’s width or alignment logic. Its faint hour labels compound the imbalance.

8. **Media’s three music choices are insufficiently differentiated.** All three covers use essentially the same artwork and embedded “EVENING HOURS” wording despite different album/playlist titles. Color changes provide limited scanning help. The destination chip, “Living Room,” lacks a clear disclosure cue, so its role as a room selector is visually weak. Descriptions sit directly over uneven photographic luminance and lose consistency in contrast.

9. **Calendar’s emphasis and information grouping need refinement.** The orange line on Design workshop has no accompanying “Up next” or other textual explanation. Its significance is conveyed only through color. Durations sit at the extreme right, disconnected from both the starting time and event details by a very large empty span. The heavy, full-width cards make four simple agenda entries feel more cumbersome than necessary.

10. **Idle Dog Walk history has uneven typographic hierarchy.** Chart ticks and weekday labels are very small relative to the large statistics and section titles. The history column’s heading sits near the chart’s outer top edge, while the chart heading is substantially inset below it. The “Streak” statistic and history column also begin on different vertical alignments. The period behind “Average walk” is unstated, unlike “This week” and the chart’s explicit range. These are clarity and alignment issues, not evidence of incorrect fixture arithmetic.

11. **Home’s material and contrast balance falls short of 9.** The nearly solid charcoal Climate panel and bright cream Lamps column create a particularly heavy light/dark split. Lamps attracts disproportionate attention across its entire surface, while Calendar and Music metadata recede. Weather’s conspicuous blue perimeter gives that tile more outlined emphasis than neighboring controls. The mixed spans and gutters are coherent; the composited visual weight is less resolved than the reference hierarchy. This is a judgment of the visible finish, not an allegation of painted borders or non-native materials.

12. **Clock-near’s small complications are less legible than its dial.** White against the prescribed green measures approximately **3.5:1**; the smaller labels consequently lack the crispness of the black numerals. The dimmed thermometer outline and sun rays are weaker still. The footer also has several competing anchors: date at left, alarm above center, dots below, and provenance offset right. The dial geometry, monochrome treatment and separation of complications from the hands are otherwise strong. These remaining details keep it just below 9.

13. **Home · More has several smaller inconsistencies.** “All lights — Some on” uses the same dark surface and white glyph language as inactive controls, while Cabinet’s on-state is emphatically warm and light. The mixed aggregate state deserves a more deliberate visual treatment. The Sonos footer breaks after “5 rooms ·”, leaving a dangling separator. In the idle walk tile, the prominent play control is clear, but the title’s separate history-navigation role has little visual distinction. That last observation concerns affordance only, not whether tapping works.

14. **Camera metadata is unnecessarily repetitive.** The tile combines LIVE, Demo feed, Cameras · 2 feeds, Lakeside, Simulated camera and a timestamp. The full-screen page adds another feed count and explanatory footer. The demo identity is appropriate; repeating it at several levels competes with the feed name and image. This is most conspicuous on the phone, where the labels occupy a large fraction of the image.

15. **iPad Now Playing uses its landscape canvas inefficiently.** The tall central stack leaves broad empty sides while pushing the volume metadata close to the pager. The art, track information and controls need a more comfortable vertical fit. The phone version is better balanced, although the subdued artist, source and timing labels remain weaker than ideal. The fixture-backed scrubber’s displayed elapsed/remaining values are coherent.

16. **The Live Activity preview clears 8.5, with minor hierarchy issues.** The Lock Screen layout gives elapsed time useful prominence. In the expanded Island layout, that same value becomes much smaller while an entire lower row repeats “Walk in progress.” The compact presentation also has a large empty separation between paw and timer. These are refinements to the visible layouts; the authorized in-app preview itself receives no penalty.

17. **Lamps clears 9 with only minor optical refinement remaining.** The inline partial-on count pulls the large “65%” numeral left of the fader’s center, slightly weakening their visual alignment. The important corrections are visibly present: clear global scope, partial-on count, luminous fill, neutral background, explicit room states, and separate power toggles and disclosures. There is no substantial remaining visual defect in this capture.

18. **Photos is the strongest complete presentation.** The photograph, time/date and dismissal control form a restrained composition. The small credit sits closer to the right/bottom edges than the time/date group does on the left, producing a minor inset imbalance. That does not threaten its gate.

**Phone bottom-clearance result: PASS for both Home and More.** The scroll-end captures show the complete final circles and their labels above the pager, with visible separation. The partial cards at the viewport boundaries in the other captures are not evidence of inaccessible content. The straight clipping boundaries remain visually abrupt, but there is no demonstrated scroll-end obstruction.

**Gate outcome:** one of the three core 9-point gates passes. Dog Walk’s idle/running tiles and Live Activity preview pass; its idle history, running history, remote-start presentation and phone history fail. Cameras and Photos pass their new-page gates; Calendar, Weather, Media, Sonos Rooms and Video fail. No motion, synchronization, gesture, hidden-control or SpringBoard behavior has been inferred from these stills.