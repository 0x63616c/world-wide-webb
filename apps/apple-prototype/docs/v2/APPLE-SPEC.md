# WWW-8 · iteration 3 Apple study

Research resumed from the retained references on 2026-10-29. This is a fixture-only native SwiftUI study, not an Apple product. Target canvas: iPad 1376 × 1032 pt; exports 2752 × 2064 px. Do not bundle reference imagery. See refs-watch/sources.md for original asset URLs.

## Reference decisions

- Calum 3 establishes the large climate control, circular clock, accessory row and continuous teal wallpaper. Keep this composition; don't replace the prototype.
- Modular / Infograph Modular establish a small number of information ranks, rounded numerical values and sparse labels. Infograph / Solar Dial establish corner complications that do not cover the dial. Palette establishes a coordinated monochrome complication treatment.
- Apple Home 26 establishes active-light state (warm glyph, legible label), simple accessory naming and separate room context. Control Center establishes a large filled brightness control and native glass for interactive controls.
- Calum 4 is a rounded *concept device*, not evidence of iPad hardware geometry. Apple Watch timer typography informs the alarm countdown, but the countdown remains the real next alarm rather than an invented timer.
- Calum 5 establishes artwork-led Music; retain the real volume and transport commands without inventing playback duration.

## Colours

Runtime UI uses semantic `Color.orange`, `.yellow`, `.green`, `.teal`, `.blue`, `.purple`, `.primary`, `.secondary` and `.tertiary`; use `.tint` on controls. Secondary text uses hierarchical foreground styles rather than manually dimmed white. No hard-coded system RGB in views.

Reference-only sRGB from Apple's current Color HIG (light / dark): orange 255,141,40 / 255,146,48; yellow 255,204,0 / 255,214,0; green 52,199,89 / 48,209,88; teal 0,195,208 / 0,210,224; blue 0,136,255 / 0,145,255. These values are not runtime tokens. Full table: refs-watch/notes/system-colours.md.

Wallpaper is the exception: the existing teal photographic-style gradient and geometric folds are original artwork informed by calum_3. Preserve its hue family but deepen the dark folds so glass has content to refract. Original fixture album artwork is also content, so its palette stays. Stored user-selected lamp RGB is data, not a system colour.

Clock wallpaper keeps the existing #43a66a hue/saturation and multiplies sRGB channels by 0.93 (7% darker). This is a named artwork token, not a replacement for semantic green. Numerals black. White hands retain shadow only for separation.

## Complication tint behaviour

Home and Controls are full-colour: orange/yellow light state, blue weather, green charging, artwork-driven music. Each value remains white or primary so colour isn't the only status cue. Clock is the accented analogue: black/green dial with one white complication foreground, `.secondary` labels and no rainbow indicators. Tesla's ring on Clock is white; on Controls/detail it is semantic green. This is a view style, not a claim these in-app views are WidgetKit extensions. A future WidgetKit facet would inspect `widgetRenderingMode` and mark accent groups with `widgetAccentable`.

## Type ramp

Native `.system` selects SF Pro with automatic optical sizing on iPad/iPhone/Mac. SF Compact / Compact Rounded are watchOS system faces: do not bundle or hard-code private font names to imitate watchOS on iPad. Use `.rounded` for compact charge/temperature data; SF Pro default for names and prose. Watch inspiration is hierarchy, not indiscriminate rounded lettering.

| Role | iPad pt / weight | Compact pt / weight |
| --- | --- | --- |
| Climate hero | 264 regular; 0.43 of 616-pt tile height | 88 regular |
| Clock display | 360–460 ultralight, the deliberate calum_6 exception | scale dial as one square, not entire app |
| Tile name | 32 semibold | 19 semibold |
| Tile subtitle | 24 regular secondary | 14 regular secondary |
| Complication value | 44 medium rounded | 26 medium rounded |
| Complication label | 20 medium | 13 medium |
| Detail heading | 28 semibold | 22 semibold |
| Brightness / battery hero | 112 regular rounded | 76 regular rounded |
| Detail body | 24 regular | 17 regular |

Apple tracking table examples: SF Pro 17 pt −0.43 pt; 24 pt +0.07; 34 pt +0.40; 40 pt +0.37; 80/96 pt zero. Rounded 17 pt +0.37 and 34 pt +0.38. These are for static mockups: the running system font already applies optical tracking. Remove `.tracking(-9)`, `.tracking(-5)` and the near-clock negative tracking. Do not double-apply the table. `.monospacedDigit()` for changing values/countdown; `.contentTransition(.numericText())` for target, brightness and battery. Use `.fontWidth(.condensed)` only for the large alarm countdown when width demands it; no horizontal scaling of glyphs.

## Shape, spacing and symbols

Use an 8-pt composition grid: 24-pt inter-tile gap, 32-pt tile content margins, 48-pt outer vertical safe space. The existing Home face remains about 1030 × 936 pt. Native continuous 56-pt tile corners; nested surfaces use outer radius minus inset, or `ConcentricRectangle` with a `containerShape`. Circular clock stays circular.

Apple Widget HIG: standard content margin is 16 pt; use 11 pt where a smaller margin improves a compact widget's layout. Our wall controls are larger custom controls, so 32 pt is a design choice (2×16), not an Apple widget requirement. A 32-pt tile title is about 10.8% of a 296-pt cell. Icon size 64 pt (21.6%); titles don't compete with the value. Use hierarchical symbols; `.symbolVariant(.fill)` for lamp/car/battery status where supported. Keep 44-pt minimum hit regions on iPhone and generous 64+ pt controls on the panel.

Corner evidence: Apple specs document rounded displays but do not publish a radius for iPad Pro/Air 13. The retained ScreenCorners first-party measurement project reports 18 pt for earlier iPad Air / Pro 11 / 12.9; no confirmed 13-inch entry. Keep `reportedIPadCornerRadius = 18` with this limitation; do not use `_displayCornerRadius` or claim 56 pt is hardware. A literal 18−28 inset is square. To satisfy the visibly round calum_4 aesthetic, the *alarm face container* uses an explicit 112-pt design radius and 32-pt inset → 80-pt ring radius. This is a documented design exception, not a fabricated hardware measurement. Equal arc-length samples and a single 4-pt stroke produce uniform ticks on all sides.

## Materials

`swiftui-liquid-glass` + `liquid-glass`: controls use native glass after sizing; nearby controls share a `GlassEffectContainer`. `.interactive()` only on actionable elements. Regular glass for text-heavy controls; clear glass only over visually rich wallpaper where text remains legible. Active light gets a restrained semantic warm tint, a warm glyph and explicit state. Remove fake white specular borders, duplicated overlay grids and custom inner strokes. Content such as weather and artwork is solid/gradient content, not glass. Native glass is reserved for the surrounding actionable control treatment. No stacked blur pretending to refract.

Native shadows first; one modest external shadow where needed for separation (no drawn bevels). Validate with the live compositor. ImageRenderer is useful for geometry but cannot certify Liquid Glass; retain hosted captures separately and finish with simctl screenshots.

## Motion

`animation-patterns`: sweeping Clock uses `TimelineView(.animation)` and date from the provider; fixed date/phase for snapshots. Weather uses MeshGradient sky and Canvas cloud/rain/sun layers selected by actual condition. Fan rotates only when on. Lamp glow uses PhaseAnimator with 3-second ease-in-out phases, opacity proportional to brightness. Sonos equalizer moves only while playing. Tesla charging uses a repeating KeyframeAnimator with a low-amplitude opacity pulse. No animated charge percentage or fictitious telemetry.

`accessibilityReduceMotion` makes these static; snapshot environment also freezes motion. Numeric updates use a 0.25-second smooth animation. Full-screen tile navigation uses matchedTransitionSource + `.navigationTransition(.zoom)` on iOS; reduced motion uses no zoom. Mac uses the same detail tree in fixed content, native dismissal controls and Escape.

## New modules and layout

Controls: Weather as a 2×2 content tile, Tesla as the upper right 1×1, Sonos below it, and Under Cabinet/Fan/All on the bottom row. This preserves six complications and makes Controls useful rather than an empty field.

Tesla mirrors the retired contract exactly: name String, nick String, place String, lat/lon Double?, charging Bool, chargingState String (including empty for unavailable legacy entity), preconditioning Bool, rate Double, pct Int, range Int, odo String, climate Int (°F). Provider availability online/asleep/offline is separate. Only setCharging, setPreconditioning commands. Fixtures Model Y / Car / Home / 78% / 241 mi / 11 kW / 64°F, no coordinates; odometer is an explicitly invented fixture. Unavailable states show pill and disable commands; stale values are labelled.

Detail: one large native battery Gauge; charge state/rate and start/stop; cabin °F and precondition; place and odometer. No map. Clock near adds a circular charge gauge and an inline charge label in its reserved corner area. Never cover 6 or let hands intersect complications.

## Platforms

`swiftui-patterns`: Mac content frame exactly 1376 × 1032, `.windowResizability(.contentSize)`, hidden title bar. Build-check macOS 26; macOS 15.6 host cannot run it. `mac-home.png` is explicitly a **Mac layout render** from the shared view tree with regular size class / desktop layout environment, UIKit `.mac` idiom traits and no titlebar, not a macOS compositor screenshot.

`swiftui-expert-skill`: iPhone selects a separate compact composition using horizontalSizeClass. Two columns, scrolling content, a square dial and full-screen details that reflow. Never shrink the entire iPad board. Native phone screenshot preferred to an artificial phone-size render.

## Why ours looks off

Measurements below use the original 2752×2064 PNGs at 2 px/pt and source layout. Reference fractions are approximate visual measurements because Calum images are perspective photographs, not orthographic design files. No false exact pt values inferred from those photos.

1. Home tile finish: 1.5-pt custom border + 0.7-pt inner border + a duplicate overlay grid sit on native glass. Calum 3 has content-dependent highlights. Remove all three; verify real compositor against patterned wallpaper.
2. Home backdrop: broad flat teal under the 1030-pt face leaves little local contrast. Calum 3 has folds across each tile. Deepen original folds moderately and reduce the milky surface layer.
3. Home text: 40-pt names / 76-pt glyphs / 28-pt subtitles in ~297-pt cells crowd the hierarchy (13.5%, 25.6%, 9.4%). Modular uses a value first and subordinate labels. Set 32 / 64 / 24 (10.8%,21.6%,8.1%).
4. Climate uses −9-pt tracking at ~283 pt despite automatic optical sizing. Apple tracking reaches zero by 80 pt. Remove tracking; keep regular numeral and balanced 64-pt chevrons.
5. Bedroom active text is dark green over a translucent teal tile, while inactive text is white. This weakens hierarchy. Use high-contrast foreground and semantic warm active control treatment; state remains explicit.
6. The Clock tile is correctly circular after 2b; preserve it. Current 1.4-pt seconds hand is pale white like the hour hand; give it a distinct semantic accent while keeping other hands white.
7. Controls devotes only one 297-pt row of a 936-pt face to content (32%). Modular Duo uses the entire face. Place Weather/Tesla/Sonos in the upper two rows.
8. Lamps places a 244×610 fader alongside a 280-pt caption column and two 204-pt circles; the room membership list is tiny and looks like documentation. Make one large brightness instrument with its value/title above, paired with coherent room rows and counts. Preserve member names in a disclosure, not as a competing permanent column.
9. Lamps brown gradient makes the UI look sepia; Control Center uses neutral material and a luminous fill. Keep a low warm field and local glow from actual brightness; use semantic orange, white fill and neutral labels.
10. Near clock has four 290×186 rectangular panels at x=44/1042, with a 56-pt alarm capsule whose top is ~893 pt, intersecting the 6. Infograph reserves corners outside the hand sweep. Make a 720-pt central dial on iPad, slimmer corner data, and place alarm in the footer below the dial.
11. Clock uses mixed #43a66a wallpaper, #153e28 card blocks and #07190d type. Palette keeps the face coherent. Preserve wallpaper at −7% brightness; black numerals and monochrome complications, fewer boxed labels.
12. Clock 12 uses −6% font-size tracking (about −30 pt). This distorts SF. Remove manual tracking; move/resize numerals with frames.
13. Alarm inner radius is 28 pt against a 1376-pt width: 2.0%, visually square. Calum 4 has a much rounder face (roughly 10–13% short-side radius after perspective uncertainty). Use the explicit 112/80 face/ring tokens, clearly distinct from unverified 13-inch hardware.
14. Alarm tick widths are mathematically 5 pt, but side antialiasing plus high density makes them look heavier. Use 4 pt throughout, 120 samples, shared round caps, with no anisotropic scale; maintain exact arc length.
15. Alarm countdown −5-pt tracking and huge 190-pt thin type need a more deliberate system instrument: use rounded regular/medium numerals, zero manual tracking, monospaced digits; adapt width on phone.
16. Music 450-pt art uses a 0.8-pt decorative border. Apple Music artwork has a clean edge. Remove it; preserve the 28-pt corner and modest artwork shadow. Add playing-state EQ without pretending there is a timeline.
17. Wi-Fi's 590-pt QR already scans and has a quiet zone; preserve it. Its password uses monospaced letters while other copy is SF. Keep monospaced credentials for accuracy, use semantic text hierarchy around them. Reflow QR width on phone.
18. Every view labels fixture data in the product footer. This is prototype provenance, not hierarchy. Keep a discreet shared fixture marker for honesty, clear of clock/date/pager; no repeated badges.
19. Current full-screen transition uses matchedGeometryEffect and delayed tasks. Native zoom has the right source/destination behavior. Switch iOS presentation to the supported navigation transition APIs.
20. Current App enforces 960×720 minimum even on iPhone and permits Mac resizing. Fix separate compact faces and exact Mac frame. Existing full-screen scaling is not phone adaptation.

## Applied skill map

swiftui-liquid-glass: face/control material and effect grouping. liquid-glass: removal of duplicate chrome, shared desktop effect behavior. animation-patterns: state-driven phase/keyframe/symbol/timeline effects, reduced motion, native zoom. apple-hig: semantic colour, tracking, type hierarchy, 16-pt widget margins, content/control material distinction. swiftui-expert-skill: observable provider seams, local view invalidation, compact reflow and test snapshots. swiftui-patterns: fixed desktop scene.

## Research limits

The retained Apple Design Resources page now promotes iOS 27; its watchOS 26 Figma template is https://www.figma.com/community/file/1540060090060216489/watchos-26. The exact iOS 26 downloadable template was not recovered from that page; do not invent measurements from an unopened template. Measurements above use the HIG tables and actual target simulator dimensions. No claimed 13-inch hardware radius without evidence.

## Review-driven refinements

Pass 3b tested regular glass. It suppressed the bright cyan line but obscured most wallpaper detail. Pass 3c returns to clear glass on the rich, less saturated original wallpaper, with native white tint; active Home accessories use native light regular glass and black text. This is an intentional active/inactive treatment based on Apple's Home controls, not a drawn rim. Weather and artwork remain content without glass.

Pass 3c reduces the near dial to 70% of 1032 pt (722.4 pt square), normalizes room naming, rounds complete alarm caps, labels the duration “Next alarm in,” aligns Music content and adds explicit Wi-Fi instructions/password labeling. Compact phone pages reserve the pager's space and use a native material backing for it. The actual iPhone 17 Pro target is 402×874 pt at 3×.

Pass 3d uses untinted native clear glass on wallpaper, localized circular lamp glow (zero alpha at its bounds), neutral Lamps material, aligned column headings, a smaller charge-ring complication and compact 140-pt complication columns. Clock corner labels use primary accented white for legibility on green; font size provides the hierarchy. The inline 78% variant is on the compact Car tile. Weather clouds have layered lobes and a soft edge rather than a horizontal blur band.

## Iteration 4 user addendum (supersedes conflicting earlier directions)

Home now explicitly requires mixed spans: 2×2 Climate, 1×2 Lamps, 2×1 Music and Car, 1×1 circular controls. Eight-point grid, consistent 24-point panel gutter; separate two-column scrolling phone composition and reserved bottom pager. The old six-tile layout is superseded. Use only native Liquid Glass, no painted tile fills or edges. The previous procedural teal wallpaper is replaced by the licence-clean Luca Bravo lake photograph documented in sources.md. The photo may be dimmed for legibility; active controls use semantic warm native tint.

Now Playing explicitly requires an honest fixture-backed time scrubber below track information (1:47 of 3:52, elapsed and negative remaining), transport next, volume below. Mock provider implements seek and elapsed playback. Production fields and seek mutation are a follow-up; the earlier no-scrubber prohibition is superseded. Keep global brightness scope, no invented timer, Tesla mock and fixture-only behavior.

All pass-4 reviews score LIVE SIMULATOR `sim-*.png` captures, not ImageRenderer/hosted draws. Home, Lamps and clock-near must each score at least 9. No pass cap.


Pass 4b makes the Home solver explicit: 224-point panel cells, 24-point gutters, 472-point two-cell spans, and 80-point top/side/bottom content margins before a separate 80-point pager band at the specified canvas. Phone has a 24-point content margin and 64-point pager band outside its scroll view. Text-bearing controls use native regular glass; active controls use a light native warm tint with dark foreground. These are prototype composition choices, not claimed HIG measurements.

## Pass 5 scope (supersedes earlier layouts and module exclusions)

Two mixed Home faces use the tested 5×3 solver, with one GlassEffectContainer per face. The primary face adds wide animated Weather and Up Next beside Climate, tall global Lamps, wide Tesla and Now Playing, plus a round Fan. Home · More adds Cameras (2×2), Photos and Media (2×1), tall Sonos Rooms and round Clock/Ceiling/Cabinet/Wi-Fi/All lights. Phone compositions scroll with the reserved page-dot band and every shortcut remains available.

Every new tile opens its full-screen page: Weather has four metrics and 12 hours; Up Next opens a day agenda; Media browses fixture albums/playlists for a selected Sonos room and a bundled silent AVKit film; Sonos Rooms reuses calibrated volume/mute/group commands; Cameras shows two animated licensed demo feeds; Photos auto-advances full-bleed licensed photos with a small time/date complication. Reduce Motion stops decorative motion and automatic photo changes. Fixture identity remains visible. No property-access module, entity, state or vehicle-access action is in scope. Sonos volume lock is retained.

Pass 5 reviews use live simulator captures for every page. Gates: Home, Lamps and clock-near ≥9 each; every newly added page ≥8.5. Keep reviewing and committing each pass until all gates pass.

## Pass 5b Dog Walk and layout update

Home · More retains every round accessory shortcut and adds Walk Zero as a 2×1 tile below a 2×1 Cameras tile. Idle shows the last walk age and duration; running shows elapsed time and the originating device. Title opens full-screen history; the separate start/stop button changes the shared active walk. The clock's lower-left complication now shows Zero and “Last walk 3h ago”, clear of hands/numerals.

DogWalkApp has generic three-week fixture history, weekly minutes/average/streak, a 7/30-day Swift Charts bar chart, and an ActivityKit widget extension for Lock Screen and Dynamic Island. `-walkStartedRemotely` shows a walk started on iPhone; time derives from the shared start timestamp, not a local counter. Cross-device start/stop is simulated through the mock backend; production persistence, subscriptions and ActivityKit push updates are follow-ups. `sim-iphone-liveactivity.png` is explicitly labelled simulator preview evidence if SpringBoard is unavailable.

Home, Lamps and clock-near retain the >=9 review gate. Dog Walk tile/history, remote state and Live Activity preview require >=8.5 along with the newly added module pages. Full-screen Weather/Calendar/Media/Sonos/Cameras/Photos are being refined independently; their Home tiles remain part of this pass.

Pass 5b phone chrome reserves an 80-point pager band (supersedes 64), with 8-point inner top/bottom caption padding; the solver keeps the final content margin above that band. Room power uses a standard Toggle, separate from member disclosure. The global brightness value includes the partial-on count.

## Pass 6 composition refinements

The authoritative review is review-5b-orch.md. The 80-point phone pager band stays reserved; its visible glass capsule is 56 points high and the scroll content fades over the final 16 points onto one continuous photo backdrop. Compact rectangular tiles use 36-point corners; circles keep their tested diameters and gutters. The photograph uses a restrained 2-point blur so the system glass has image detail to refract.

Wide-tile metadata uses 24-point panel text; Sonos Rooms uses 20-point playback states and an explicit “All 5 rooms ›” link. Walk Zero separates “History ›” from a 72-point circular Start/End action. An active walk’s full-screen page has a 64-point monospaced elapsed value, a 20-point Elapsed label and a separate originating-device line. History timestamps are 20 points and the period control reserves 48 points. Compact history removes the redundant page headline.

Lamps centres the brightness value over its 224-point fader, with the partial-on count on a separate line and one global-scope instruction. Clock date and alarm share the footer baseline above the pager, and the car ring includes a percent unit. Now Playing uses 440-point artwork and reserves the 80-point pager band beneath its content stack. These are measured prototype choices from the review, not claimed Apple HIG requirements.

The ship gate includes iPhone Home at ≥9.0 along with iPad Home, Lamps and clock-near. Other owned pages/states require ≥8.5. Captures must use the shared simulator lock and pass the blank/SpringBoard validator. Independent review uses the unchanged REVIEW-PROMPT-orch.txt.

Pager dots retain their small visual marks inside 44×44-point rectangular hit targets. A tile header’s complete row is tappable, including the space between its label and disclosure.

## Pass 6b refinement

Dog Walk uses a fixed 144-point status region for idle, local and remote states; statistics and equal-height chart/history panels remain stationary. Reading panels use native regular material, 28-point panel padding and 96-point history rows with 20-point timestamps. The panel history scrolls independently to retain the complete three-week log.

Phone Home reduces Climate to 240 points and Weather to 160, preserving the 88-point setpoint and 48-point actions. Both scroll edges fade over 16 points into the continuous wallpaper; the reserved pager band remains 80 points. Calendar separates the 32-point event, 24-point time and 20-point venue. Sonos room names use 22-point semibold and states use 20-point secondary text. Walk tile title and History remain pinned to the same top/bottom insets in both states. Previous/next commands use endpoint symbols at 42 points in 72-point targets. Lamps explicitly labels the global effects scope. Clock date/alarm use a shared 20-point medium white baseline; numeral positions and hand lengths reserve a clear central sweep. These are prototype design choices, not claims of required HIG dimensions.

The 240-point compact Climate card places its 48-point minus/plus actions beside the 88-point setpoint, with the setpoint caption below, to retain the full type size without vertical compression.


## Pass 6c: deterministic contrast and clearance refinement

Home retains the tested mixed-span solver and all 24-point panel gutters. The photo wallpaper receives 28% black dimming (previously 18%; a 12% relative luminance reduction), while tile surfaces remain native Liquid Glass with restrained tint. Home Lamps uses a 20-point helper with 16-point separation: “Adjusting turns all 8 on.” Calendar venue and accessory state use primary foregrounds. Cameras has its own Home caption composition with a feathered photo scrim; Sonos names are 24 points and state/volume share a 20-point line.

Phone Climate uses a 76-point value, 19-point heading, 17-point controls and 48-point targets. The explicit scroll fade stays 16 points; automatic edge effects are disabled on this composition so a second blur cannot extend it. The pager is 200×56 points inside the unchanged 80-point band, with four 44-point targets and clear native glass over the continuous photo.

Dog Walk retains the identical 144-point hero allocation in idle/local/remote states. Its 64-point elapsed value and 24-point device/last-walk status share a leading edge, with a local feathered dark scrim. Semantic-green walk actions use black foregrounds; tile targets remain circular 72 points and full-screen labels are 24-point semibold. “Average per walk” names the statistic explicitly. Chart and history retain equal-height native regular-material panels.

Lamps uses centered 320- and 472-point columns separated by 64 points, with a shared 64-point “All lamps · Color & Effects” action below both. Clock hand lengths reserve a 24-point minimum gap from numeral glyphs throughout rotation; a native SF raster geometry test checks the full sweep at near, idle and compact dial sizes. Music elapsed, remaining and volume metadata use 20-point primary foregrounds.

All live captures launch with `-snapshot`: 2026-10-29 10:10:30 Pacific, motion phase zero, fixed page/scroll/state, deterministic Mood colour ordering. Snapshot readiness pins landscape on iPad and portrait on iPhone; wrong-orientation captures are rejected even if nonblank. The capture script validates each PNG and independently relaunches each screen twice, requiring full-resolution RGB mean absolute difference ≤0.5/255 in `determinism.tsv`. Three cold reviews use the unchanged orchestrator prompt. Per-screen medians must not regress from the accepted baseline; Home, Lamps, clock-near and iPhone Home require 9.0, and other captures require 8.5. No full-size evidence is newly committed under docs/screenshots/v6.

## Iteration 7 candidate compositions

This section supersedes earlier visual layout/type prescriptions for the three redesign candidates. Home now uses a single 2×2 Climate hero, wide Music/Tesla, tall Lamps brightness, square Weather/Up Next, and a trailing Ceiling/Fan/Wi-Fi circle rail. The 5×3 lattice, 24-pt panel gutters and 80-pt outer margins remain. Repeated quick-access shortcuts across Home and More share provider state and have unique IDs within each face. Phone pairs Weather and Up Next above the instrument/accessory group; wide media/car controls and all remaining round shortcuts remain scroll-reachable.

Lamps centres its 224×384-pt brightness instrument between equal 280-pt room controls with standard switches and separate member disclosures. The global effects action is centred below it. Clock replaces the green poster-number composition with a black circular watch-inspired instrument, restrained green cardinal numerals, 60 minute marks, white hour/minute hands and a green seconds hand. Four complications occupy dedicated corners, with date/alarm on the lower baseline. The dial replaces the older ultralight numeral exception. No app pager is painted on Clock; horizontal face swipes remain available. Native SF Rounded, no private fonts, and full-sweep 24-pt glyph clearance tests apply.

These are candidates until three independent cold-review medians meet or exceed each screen's accepted floor.

## Pass 7b acceptance refinement

Phone uses full-width Weather/Up Next modules with the lower quick controls and separate pager. Its bounded opacity fade is 8 pt. Detailed per-screen acceptance history belongs in iterations.md, outside the design requirements.

Home’s setpoint and minus/plus targets form one instrument row. The Lamps tile says “Adjusting turns all 8 on,” with a native material recess behind its white fader. All active light tiles use the same warm system-glass tint. The full Lamps page aligns its 280-pt room cards with the actual 224×384-pt fader, leaving 64-pt gaps to the instrument; standard switches align with room names and member disclosure is separate.

Dog Walk detail uses a stable black content background with native regular-material chart/history panels. Its green action has black text, 24-pt semibold labels, and extra-large system sizing on iPad. The fixed 144-pt status region keeps its 64-pt timer and 24-pt origin aligned across states. “Average per walk” is explicit; statistics align to the chart/history subdivision, and history indicates that it scrolls. This replaces the previous photograph/local-scrim treatment for this content page; Home glass still sits over the photograph.

## Pass 7c Home recovery and boundary geometry

The primary Home returns to its earlier seven-module composition: Climate 2×2 at (0,0), Lamps 1×2 at (2,0), Weather 2×1 at (3,0), Tesla 2×1 at (3,1), Calendar 2×1 at (0,2), Music 2×1 at (2,2), and Fan round at (4,2). Other round shortcuts and every additional module remain on More. This supersedes the nine-module candidate and square information modules described above. The separate Lamps and black Clock designs retain their compositions.

Home and More now trial the bundled licensed ForestPhoto as their shared backdrop, retaining the 2-pt blur and 28% dimming. Native regular glass has no extra neutral tint; active lights share a restrained warm native tint. The Home fader gets an 8-pt native regular-material surround around its complete perimeter. No tile rim or simulated glass is drawn.

Phone keeps full-width Climate/Weather/Calendar followed by tall Lamps/round controls, wide Music/Tesla, and round quick actions. Its one gutter is 24 pt, with minimum 24-pt outer margins and the existing 80-pt pager reservation. Compact heights are Climate 240, Weather 152, Calendar 144, Music 120 and Tesla 136 pt. These proportions preserve the full Music contour at the bottom scroll anchor on iPhone 17 Pro; a frame test verifies its top clearance. The bounded 8-pt bottom fade reaches zero opacity before the following tile’s material edge.

All lights distinguishes a mixed state with an orange glyph and explicit “Some on” text; the existing glyph command and full-screen detail behavior stay intact. More uses 32-pt wide headings, 24-pt room names, 20-pt secondary metadata and footer links aligned 32 pt above their shared lower edge. Walk’s elapsed value is 44-pt rounded monospaced, with subordinate elapsed/origin labels and the 72-pt action preserved. Full-screen Walk, Music, Lamps and Clock content are unchanged in this pass.


## Pass 7d material and tile corrections

The ForestPhoto background trial is removed. Home/More now trial the existing licensed CoastPhoto with its crop anchored at the top, photographic saturation at 75%, and the existing 2-pt blur/28% dimming. All control surfaces remain native regular glass; active lighting retains its native warm tint. This supersedes the forest backdrop paragraph above. The recovered seven-module lattice and 24-pt gutters remain.

The panel thermostat groups 64-pt minus/plus targets beside its 152-pt value, with the setpoint caption 24 pt below. The phone keeps its 76-pt value and 48-pt targets. Home Photos and Cameras share 32-pt headings and insets, 24-pt descriptive metadata, 20-pt bottom captions and feathered photographic text contrast. Home Photos still crossfades its licensed collection and stops automatic changes in Reduce Motion or snapshot mode; full-screen pages remain independent. Walk’s 44-pt timer now begins at the same leading edge as its origin/history, with a small trailing elapsed label.

The phone’s existing 8-pt top fade starts with a 4-pt clear strip; at the lower anchor, a geometry assertion keeps the preceding tile entirely in this strip while Music retains its complete contour. The 80-pt pager reservation and safe margins stay intact.


## Pass 7e material and compact control grouping

This supersedes the pass-7c/7d backdrop and material experiments. Home and More use the original licensed LakeWallpaper with 65% photographic saturation, 62% global dimming and no global blur. Native clear Liquid Glass reveals the photograph; active lights use regular Liquid Glass with 8% orange tint in dark appearance. The only brightness fill is the actual brightness control. No custom tile fill or rim is drawn. The panel retains its seven-module spans and 24-point gutters.

On iPhone, the 216-point Climate module is followed immediately by the tall Lamps control and Ceiling/Fan circles. The 76-point setpoint and 48-point minus/plus targets are retained, with current indoor temperature/status below. Weather and Up Next follow this control group. All compact circles use 17-point semibold titles and 14-point regular states. The 80-point pager band, 24-point gutters/margins, complete bottom Music contour and bounded 8-point fade remain. The geometry suite asserts the four primary controls fit inside the first viewport.

Lamps keeps the central 224×384-point brightness instrument and 64-point side gaps. Room cards use 24-point insets, 48-point switch/header rows and restrained native warm tint rather than a large ivory surface. More destination headings are 28 points, Walk remains 32 points, and Sonos room names are 22-point medium with 20-point state text. The running Walk tile retains its 44-point elapsed value without a duplicate inline label, followed by its origin and a semibold History action. Clock, Music and full-screen Walk content retain their accepted compositions.


## Pass 7f reading surfaces and module regrouping

The pass-7e clear-control treatment is removed. Home/More return to the original LakeWallpaper with 2-point blur and 28% dimming. Text controls use native regular glass; active Home lights use a restrained 4% orange tint in dark appearance. Photo/weather content uses clear glass. No custom tile fill or outline is added.

Panel Home: Climate (0,0,2,2), Lamps (2,0,1,2), Weather (3,0,1,1), Ceiling (4,0,1,1), Tesla (3,1,2,1), Calendar (0,2,2,1), Music (2,2,2,1), Fan (4,2,1,1). Weather has a compact vertical hierarchy: 20-point city, 64-point value, 30-point condition symbol and 20-point condition/range. The first Home now contains two round accessory controls. Lamps combines its icon/title in one line to give its inline brightness control more height.

Panel More: Cameras (0,0,2,1), Photos (2,0,2,1), Clock (4,0,1,1), Walk Zero (0,1,2,1), Media (2,1,2,1), Ceiling (4,1,1,1), Sonos Rooms (0,2,2,1), Cabinet (2,2,1,1), Guest Wi-Fi (3,2,1,1), All lights (4,2,1,1). Sonos shows the first two room summaries side by side under one 28-point heading; the 20-point “All 5 rooms” footer opens every room. All origins/spans still come from the shared solver, with 24-point gutters and safe pager margins.

Phone retains its pass-7e control grouping. The thermostat’s 76-point number now has a 13-point Target caption; indoor status remains separate. Large numerals use bounded optical layout heights to keep their captions nearby. Music and Tesla share a 72-point artwork column, 16-point inset and 16-point text gap. The running Walk tile uses a 20-point primary origin line. Full-screen Lamps restores 32-point room-card insets, 64-point switch/header rows and warm light-appearance active glass; its centered fader/scope remain intact. Full Clock, Music and Walk detail layouts are unchanged.


## Pass 7g current Home composition

This supersedes the rejected Home/More material and regrouping trials in 7c–7f. Restore the seven-module Home: a 2×2 Climate hero, 1×2 Lamps control, wide Weather/Tesla/Calendar/Music and one Fan circle. More restores its tall Sonos Rooms summary and the five round shortcuts. Native regular glass uses dark inactive and warm light active appearance; image modules retain clear glass. LakeWallpaper stays at 2-point blur and 28% dimming, with no new assets.

The panel grid is anchored to the top of the page container so the live TabView preserves the solver's equal 80-point outer margins on the 1376×1032 canvas. A live-window UI test checks the actual header/side/bottom edges above the 80-point pager. The layout solver continues to enforce all 24-point gutters and circle separation.

Phone returns to Climate, Weather and Up Next in its first viewport, with 240/152/144-point heights. The two-column Lamps/Ceiling/Fan group follows; Music and Tesla preserve their complete bottom-scroll contours. The 24-point gutters/margins, 80-point pager band and eight-point scroll fade remain. Fully occluded modules are removed from the render tree so their system glass cannot reflect above the visible Music card. The 64-point phone fader uses a 32-point sun symbol with a 16-point bottom inset; the full-screen instrument is unchanged.

Full-screen Lamps, Clock, Music and Walk retain their accepted compositions. The Walk tile restores its explicit elapsed label and originating-device line. This section describes implementation, not a review score or acceptance claim.
