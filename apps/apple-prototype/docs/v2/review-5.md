**Overall: FAIL. Home does not clear 9. Lamps does not clear 9. Clock-near clears 9. Several new pages miss 8.5.**

I inspected all 18 live simulator screenshots and the relevant Calum, Apple Home, Control Center, and Watch references. I applied the iteration 4/4b and pass 5 overrides in [APPLE-SPEC.md](/tmp/www8-review-5/APPLE-SPEC.md). These are visual scores; they do not certify interaction or implementation.

The licensed photography, animated demo feeds, fixture Sonos commands, and fixture-backed scrubber receive **no deduction for being simulated**.

| Capture / evaluated surface | Score /10 | Gate result |
|---|---:|---|
| [Home — sim-home](/tmp/www8-review-5/sim-home.png) | **8.5** | **FAIL ≥9** |
| [Home · More — sim-controls](/tmp/www8-review-5/sim-controls.png) | **8.2** | **FAIL ≥8.5** |
| [Lamps](/tmp/www8-review-5/sim-lamps.png) | **8.7** | **FAIL ≥9** |
| [Clock-near](/tmp/www8-review-5/sim-clock-near.png) | **9.0** | **PASS ≥9** |
| [sim-weather — entire capture](/tmp/www8-review-5/sim-weather.png) | **8.5** | **FAIL Home ≥9** |
| Weather tile specifically, within Home/sim-weather | **8.6** | **PASS 8.5 floor** |
| [Weather full screen](/tmp/www8-review-5/sim-weather-full.png) | **8.3** | **FAIL ≥8.5** |
| [Calendar](/tmp/www8-review-5/sim-calendar-full.png) | **8.6** | **PASS ≥8.5** |
| [Media browse](/tmp/www8-review-5/sim-media-full.png) | **8.0** | **FAIL ≥8.5** |
| [AVKit video sheet](/tmp/www8-review-5/sim-video.png) | **8.0** | **FAIL ≥8.5** |
| [Sonos Rooms](/tmp/www8-review-5/sim-sonos-rooms.png) | **8.2** | **FAIL ≥8.5** |
| [Cameras](/tmp/www8-review-5/sim-cameras-full.png) | **8.6** | **PASS ≥8.5** |
| [Photos face](/tmp/www8-review-5/sim-photos-face.png) | **9.0** | **PASS ≥8.5** |
| [iPad Now Playing](/tmp/www8-review-5/sim-nowplaying.png) | **8.6** | Above 8.5; no separate named gate |
| [iPhone Home — top](/tmp/www8-review-5/sim-iphone-home.png) | **8.3** | **FAIL Home ≥9** |
| [iPhone Home — scroll end](/tmp/www8-review-5/sim-iphone-home-bottom.png) | **8.5** | **FAIL Home ≥9; clearance PASS** |
| [iPhone More — top](/tmp/www8-review-5/sim-iphone-more.png) | **8.2** | **FAIL ≥8.5** |
| [iPhone More — scroll end](/tmp/www8-review-5/sim-iphone-more-bottom.png) | **8.3** | **FAIL ≥8.5; clearance PASS** |
| [iPhone Now Playing](/tmp/www8-review-5/sim-iphone-nowplaying.png) | **8.7** | Above 8.5; visible clearance PASS |

`sim-weather.png` is **pixel-identical** to `sim-home.png`. Its whole-capture score is therefore identical; the Weather component score is explicitly separate.

The concrete flaws, ordered approximately from most consequential to least:

1. **Media browse: secondary information disappears into the photograph.** Album/playlist descriptions and the provenance line sit directly over detailed rock, trees, and water. Their gray foreground is too weak for dependable scanning. The white titles survive; the information explaining what each item actually is does not have equivalent protection.

   All three music covers also say “EVENING HOURS,” although two items are named “After the Rain” and “Soft Focus.” Recoloring the same cover gives weak visual identification. The room selector lacks a clear selection indicator such as a chevron, and the licensing sentence plus separate fixture footer creates two competing provenance locations.

2. **Video: the sheet’s proportions poorly serve the film.** Approximately **39% of the sheet’s height is black space** above and below the picture. Preserving the film’s aspect ratio is correct; placing it inside this nearly square container produces a bulky presentation. The title capsule floats in an oversized black header, while the lower black band contributes nothing in this captured state. The underlying library remains visually busy around the sheet, including its separate close button.

   I am **not** counting the absent transport controls as a defect: a still cannot establish whether AVKit has simply hidden them.

3. **Sonos Rooms: the grouping relationship is visually ambiguous.** Living Room ends with “Desk,” while Desk ends with “Group.” A member name and an action occupy the same position and treatment, without a strong shared-group indication. The screenshot requires interpretation to understand which rooms belong together.

   Track names and paused states are too faint. The very long sliders pull attention away from room identity, and the small trailing grouping controls feel subordinate to an excessive amount of track. “Volume is relative to each room’s calibrated baseline” is technical explanatory copy given prominent placement beneath the main heading.

4. **Phone chrome: bottom clearance is fixed, but the edge treatment remains unfinished.** Scrolling content ends at a hard horizontal boundary immediately above the pager region. The More top capture cuts through the Media card; the More scroll-end capture cuts through it beneath the upper wallpaper band. These are viewport boundaries, not evidence of inaccessible content, but the abrupt cuts look mechanical.

   Across all five phone captures, “Fixture data” sits only a few points above the pager capsule’s lower edge. The capsule has comfortable space around its dots and noticeably insufficient padding beneath its text. That imbalance is especially obvious against the plain Now Playing background.

5. **Home · More: the tall Sonos tile is under-composed.** Three room summaries occupy its upper portion, followed by a large empty area and a detached “5 rooms” footer. Its interior density does not match the neighboring Camera, Photos, and Media tiles.

   The camera shortcut identifies itself primarily as “Lakeside”; nothing prominent communicates that it opens a two-camera overview. On phone, the fully visible Sonos summary shows two rooms but loses the useful total-room count. The large square camera preview also pushes most other More content well below the initial viewport.

6. **Weather full screen: the forecast strip does not resolve against the page grid.** The four metric cards span almost the full content width, but the twelve-hour row stops substantially earlier, leaving an unexplained empty area on the right. The current temperature and condition are separated by a broad empty center, making the top section feel stretched.

   Hour labels are faint against the cloud field. The cloudy background, pale labels, and large unused lower area make this page less crisp and deliberate than its compact tile.

7. **Home: strong geometry, uneven visual emphasis.** The warm Lamps tile becomes the brightest, most dominant object despite Climate receiving the largest span. Its small “3 of 8 on” and adjustment instruction carry essential scope information but receive the weakest treatment within that tile.

   Climate’s current-temperature/status line, Calendar’s time/location, the music artist/room, and the car’s range are consistently subdued. Meanwhile, the detailed wallpaper remains conspicuous through the gutters. The result has less separation between interface and scenery than the Apple Home reference.

   The inactive tiles appear heavy and dark in these live captures. That is an appearance judgment—not an allegation that their materials are painted or non-native.

8. **Weather tile: the perimeter is too conspicuous.** Its thin cyan edge, particularly on phone, reads more like an outlined panel than the quieter surrounding surfaces. Whatever produces that edge, it attracts unnecessary attention. “Partly cloudy” and the high/low line also sit over relatively bright cloud detail, reducing their visual stability.

9. **Lamps: the two-action room cards need clearer hierarchy.** “Turn off/on” at the upper right and “Show lamps” across the lower portion share one uninterrupted surface. The visual distinction between toggling a room and opening its members is weak.

   The inactive room surface barely separates from the black canvas. The brightness instrument and room column also finish at different heights, with the large slider extending below the Color & Effects control. The composition is orderly, but its lower alignment and action grouping are not yet at the 9-level finish.

   The global control’s **partial-on state** would be easier to understand if “3 of 8 on” appeared directly alongside its large value; currently that state must be assembled from the room cards and explanatory sentence.

10. **Calendar: clear structure, weak secondary hierarchy.** Locations, AM/PM labels, and durations are considerably fainter than event titles. Durations sit at the extreme opposite edge from their associated times and names, requiring unnecessary horizontal scanning.

    The orange rule distinguishes Design workshop without explicitly explaining whether it means “next,” selection, or calendar category. The completed morning event otherwise has almost the same emphasis as future events. These are refinements rather than layout failures, which is why the page clears 8.5.

11. **Now Playing: iPad spacing is less resolved than phone.** The iPad artwork and controls form a narrow central stack with substantial empty side space, yet the volume labels finish very close to the pager/footer area. That combination feels vertically crowded despite the available canvas.

    On both sizes, artist, elapsed/remaining time, and volume metadata are somewhat too dim. On phone, the artwork has a substantially narrower width than the title and progress track, weakening the otherwise clean alignment. The pager’s low text padding remains the most visible phone finish issue. The required scrubber → transport → volume order is correct.

12. **Cameras: excessive labeling competes with the feeds.** “2 demo feeds,” “LIVE,” “Demo feed,” “Simulated camera,” the explanatory sentence, and “Fixture data” repeat closely related context. The demo identity is appropriately explicit, but it can be communicated with less scattered text.

    Repeating the lake photograph as both the full-page background and one feed weakens separation between the camera content and its surroundings. The explanatory line below the feeds has poor contrast against the lake. Feed names and timestamps themselves remain readable.

13. **Clock-near: only minor visual defects remain.** The thermometer’s hierarchical outline is noticeably fainter than the other complication glyphs. Otherwise, the intended black/green dial, white hands, monochrome complications, and separate alarm footer are coherent.

    **The complications do not collide with the dial, the charge ring does not cover the 6, and the alarm clears it.** The oversized numerals are an explicit reference-driven exception, not a defect. This earns **9.0**, without rounding up a lower score.

14. **Photos face: the small credit is the remaining weakness.** The lower-right credit sits over textured grass and is harder to read than the time/date complication. The photograph otherwise has appropriate priority, the crop is convincing, and the restrained time/date placement works. This clears 9 visually.

**Gate results:**

- **Home ≥9: FAIL — 8.5 on iPad; phone captures also remain below 9.**
- **Lamps ≥9: FAIL — 8.7.**
- **Clock-near ≥9: PASS — 9.0.**
- **Every new page ≥8.5: FAIL.** Calendar, Cameras, and Photos pass. Home · More, full-screen Weather, Media browse, video, and Sonos Rooms fail.
- **Phone scroll-end bottom clearance: PASS for both Home and More.** The final circular controls are fully visible, with roughly **28 pt** between their bottom edge and the pager capsule. The top captures do not justify an obstruction finding.
- **Behavioral requirements remain unverified:** hit regions, seeking, grouping/muting, volume lock, transitions, animation, Reduce Motion, and access to shortcuts outside the captured scroll positions. They receive neither credit nor deductions from these stills.