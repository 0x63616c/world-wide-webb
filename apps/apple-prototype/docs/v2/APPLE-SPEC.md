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

Tesla mirrors the retired contract exactly: name String, nick String, locked Bool, place String, lat/lon Double?, charging Bool, chargingState String (including empty for unavailable legacy entity), preconditioning Bool, rate Double, pct Int, range Int, odo String, climate Int (°F). Provider availability online/asleep/offline is separate. Only setLock, setCharging, setPreconditioning commands. Fixtures Model Y / Car / Home / 78% / 241 mi / 11 kW / locked / 64°F, no coordinates; odometer is an explicitly invented fixture. Unavailable states show pill and disable commands; stale values are labelled.

Detail: one large native battery Gauge; charge state/rate and start/stop; lock/unlock; cabin °F and precondition; place and odometer. No map. Clock near adds a circular charge gauge and an inline charge label in its reserved corner area. Never cover 6 or let hands intersect complications.

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
