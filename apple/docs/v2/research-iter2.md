# WWW-8 v2 iteration 2 — research before implementation

Research completed before source edits, 29 October 2026. Primary target: Calum's wall Home face. Sources inspected directly: both Calum PNGs, contact_sheet.png, all 17 film JPEGs, and all 20 newsroom JPEGs. The requested `refs/film/*.png` glob has no files; the available frames are `.jpg`. Enlarged crops and overview sheets were made in /tmp for inspection, never bundled or committed. Prior notes and iter-1.png were also reviewed.

## Measurement method and limits

Ratios below use the **active screen**, excluding the case, wall, speaker and photographic border. Small-tile height is H, small-tile width W, active-screen height S. Pixel bounds are manually estimated from the supplied raster, with roughly ±2–4 px uncertainty on Calum's small reference. Perspective compresses the wall image horizontally: do not use its 90×130 projected tiles as the desired aspect ratio. The front-on purple face is the cross-check. Visible glyph/letter ink height is different from the font's em size; SF caps are roughly 70–75% of the nominal size. Font weight is a visual inference, not font metadata. Alpha, blur radius and shadow values cannot be uniquely recovered from a flattened photo; estimates are explicitly marked.

## Calum 3: wall Home face (653×653)

Active screen: approximately x166–458, y112–539, with sloping top/bottom edges. Climate: x171–350, y126–390 (projected height ~264). Bottom tiles: x172–254 / 259–350 / 355–450, y395–523/534 (local H ~128–134). There are **six panels in a 3×3 slot structure**: one 2×2 Climate, clock, photo, three accessories. Climate occupies ~2/3 screen width and height, ~44% of its area. Clock is circular inside its slot, not a square app icon.

| Property | Observed measurement / proportion |
| --- | --- |
| Gutters | 5–8 projected px; ~0.04–0.065 H, ~0.06–0.09 W. Front-on check puts the intended gutter near 6% of a cell side. |
| Corner radius | Small panels ~20–26 projected vertical px, 0.16–0.20 H. Climate uses a similar absolute radius, ~0.08–0.10 of its height. |
| Numeral | `68` ink y201–282 (~81 px), ~31% of Climate height, ~19% S. Horizontally centered within Climate. Stems look Regular, perhaps Medium after photograph sharpening; not Thin. Nominal SF size ~43–46% of Climate height. |
| Accessory glyph | Fan ~33–37 px, lock ~32–35, pendant ~39–42; ~25–31% H. Glyph center near 0.32 H; no app-icon background. |
| Name / subtitle | Name ink ~9–11 px, ~7–9% H; subtitle ink ~10–12 px, ~8–9% H (perspective/antialiasing makes exact caps uncertain). Approximate nominal SF sizes 12–14% / 10–12% H. Name Semibold/Bold, subtitle Regular at ~55–65% white. Centered, tight two-line block in lower third. |
| Climate labels | Name ~10 px ink, subtitle ~11 px; centered at ~0.83 H of Climate. Bare white chevrons flank the label block at the lower corners. |
| Glass | Teal comes mostly from wallpaper, with a modest translucent white lift (estimated 5–15%), not cyan paint. Shapes remain clearly identifiable but softened/refracted, particularly at rounded corners. No exact alpha can be measured. |
| Edge | Narrow white upper/left specular line, approximately 0.5–1 raster px (~0.004–0.008 H); dim opposite inner edge. Brightness is uneven around the perimeter. |
| Shadow | Small dark separation below/right of panels, ~0.02–0.06 H visible reach; hard to separate from wallpaper. Large device-on-wall shadow is physical photography, not a tile shadow. |
| Wallpaper | Large overlapping angular petals, pinwheel/fan forms and arcs. Main forms span ~0.35–0.8 S, with some finer folded detail. Teal-only; broad regions estimated #064b4b–#438e87. More contrast than iter-1, but foreground white still dominates. |

Calum's requested 25% glyph / 13–14% name font / 9–10% subtitle font is consistent with the reference once nominal font sizes and projected ink bounds are distinguished. We will use these **requested nominal ratios**, not mistake the small source's antialiased ink bounds for point sizes.

## Calum 2: face collection (2560×1440)

13 device faces arranged 4 / 5 / 4; this is a marketing collection, not one application's 13-tile grid. Purple Home active area approximately x1580–1899, y560–879 (~319 square). Its Climate is ~205 square, small cells ~98, gutters 5–7. Measurements below are from this front-on view.

| Face | Grid / scale / type | Material / wallpaper / edge / shadow |
| --- | --- | --- |
| Purple Home | Same six-panel 3×3 structure. Gutter 0.05–0.07 H; radius ~0.17–0.21 H. `68` visible height ~64 px / 205 = 31%; SF Regular. Accessory glyphs ~23–29 px / 98 = 23–30%. Name ink ~8–10%, subtitle ~8–10%; nominal font ~13–14% / 10–12%, semibold/regular. Climate labels occupy lower 20%; chevrons flank them. | Purple translucent lift (estimated 8–18% white), visible diagonal folded forms crossing panels, fine white rim brightest top/left and bottom right. Forms ~0.25–0.7 S, medium contrast. Tile shadow slight; strong shadow below whole product is photographic. |
| Weather, left middle | One full face, no tile grid; 54° ink ~28% S, Regular. Top condition/time ~5–6% S nominal. Four equal bottom metric columns, symbols ~6% S, labels/value nominal ~5% S. No gutters/radii between metric columns. | Full-bleed clouds/blue sky; forms ~0.3–1 S, white text with no outlined boxes. Translucent hero numeral, opaque smaller labels. No internal panel shadow or rim. |
| Modular date/weather/clock, upper left | Four semantic regions, roughly 2×2 without panel borders. Date `1` ~25% S ink, weather `54` ~15%; clock diameter ~39% S. Metadata ~3–5% S, medium/regular. | Opaque muted blue-grey; no glass, gutters or tile shadow. Grouping comes from alignment and type scale. |
| Photo clocks, top right / middle center / bottom near right | One photo with tall time digits, ~0.8–0.9 S height behind the subject; very condensed Regular. No small complication grid. | Photo determines contrast; translucent time, depth mask around subject. No internal rim/shadow. Not a suitable texture source for our procedural face. |
| Green analog, bottom | One dominant full-face dial. Numerals ~0.35–0.45 S, Light/Regular; hands ~0.65–0.75 S span; date ~0.04 S. | Flat green/black, white hands. No tile glass, radius or internal shadow. |
| Pink analog, bottom right | One dial, numerals ~0.12–0.15 S, fine embossed strokes; hands ~0.65 S span. | Tonal pink, subtle numeral bevel and hand shadow. No tiles or wallpaper shapes. |
| Flow / Snoopy / calendar | Full-face compositions: no accessory grid. Flow digits occupy most of S; Snoopy date ~0.55 S; calendar 7 columns. | Each has one visual theme. Their variety supports separate faces, not combining all content onto Home. |

## Film frames — every file inspected

All are 1920×1080. The screen is tilted and the hand occludes some labels; ratios use local screen/tile dimensions. Common home layout in 110.6–111.4: six panels on 3×3 slots with a 2×2 camera, round clock upper right, lock middle right, three bottom accessories. Cell H approximately 160–190 px; gutter ~5–9 px (3–6%), radius ~25–35 px (15–20%). Bottom `70` visible ink ~40–50 px (25–30% H), Regular. Icons ~23–30% H; name/subtitle nominal ~12–14% / 9–11% H. Off panes have a neutral translucent grey lift; on thermostat/blinds are bright off-white with dark text. No amber lamp is visible in these frames, so amber here is a brief/Apple Home convention, not something proved by this film.

| File(s) | Specific observation; all unspecified values inherit the common home measurement above |
| --- | --- |
| film_110.6s.jpg | Six-panel resting camera face. Dim neutral wallpaper; large camera image supplies the detail. White top/left rims, subtle dark lower seams; no measurable geometric wallpaper. |
| film_111s_home-grid-glass.jpg | Same six panels, two bright ON panels; diffuse grey reflection on clear ones. Wallpaper is nearly uniform, so optical transparency cannot be determined reliably. |
| film_111.2s.jpg | Same grid and labels; touch approaches thermostat. Border remains fine, no cyan rim. |
| film_111.4s.jpg | Touch begins; structure unchanged. Text weights remain Regular/Semibold. |
| film_111.5s.jpg | Thermostat panel has lifted/grown from its bottom-right source. Radius proportional to original panel; background dims and blurs. `70` ~28% expanded panel height. A distinct soft shadow separates the lifted panel. |
| film_111.6s.jpg | Expanded blue controller covers ~80–90% active screen; old face remains blurred behind it. No stable grid/gutter measurement applies. |
| film_111.7s.jpg | Controller nearly full-screen. `70` ~22–25% S ink; caption ~4% S, chevrons ~4–5%. Saturated blue, extremely faint shapes. |
| film_111.8s.jpg | Full controller; top ×/title/time arrive. × circle diameter ~9% S; symbol ~4%. Background is opaque blue. |
| film_112.0s.jpg | Same finished controller. White Regular large numeral, caption/footer roughly 4–5% S; no tiles or panel shadow. |
| film_112.3s.jpg | Same hierarchy; bottom corner mode control. Glass limited to circular functional controls; their white rim is faint. |
| film_112.5s_thermostat-controller.jpg | Clearest controller reference: centered title, close left, time right; caption/value/footer centered. Blue field with faint broad shaded forms. Supports Lamps' saturated full-screen treatment, not its invented layout. |
| film_112.8s.jpg | Wide scene, active screen too small for credible label/radius measurement; same blue controller visible. |
| film_123s_doorbell.jpg | Full-screen live video, title at top; 3 bottom circles ~12–15% S diameter, glyphs ~6% S. Red/yellow/neutral functions. No tile grid, geometric wallpaper or measurable internal shadow. |
| film_132.5s.jpg | People watching device; active screen not visible. All UI measurements N/A. |
| film_133s_doorbell-controls.jpg | Front-on video controller, three bottom circles at ~14% S, labels ~3–4% S. Neutral action is clear glass over video; white edge thin, no independent wallpaper. |
| film_178s_photos-clock-face.jpg | One photo-clock face. Large time ~25% S visible ink, semibold. No tile gutters, glass rim or tile shadow; photo is full screen. |
| film_47s_personal-home-screen.jpg | Actual app launcher: 2×2 icons plus a 2-row calendar widget. Icon containers ~18–22% S, rounded square radius ~23% icon width, names ~4–5% S. Photo blurred behind. Explicitly a different surface from Home Modular; do not copy this launcher structure. |

## Newsroom — every file inspected

Names below omit the common `Apple-HomeView-` prefix and `-261013` suffix. N/A means the shot does not expose that attribute; no invented measurements for rear views or unreadable screens. Material alpha remains an appearance estimate.

| File | Grid, gutters, radii, numerals, icons, labels | Glass, edge, shadow, wallpaper |
| --- | --- | --- |
| wall-mounted_inline | Same source composition as calum_3, at 1306 square. Confirms six panels, ~6% gutters, ~18% cell radius, ~31% Climate numeral ink, ~25–30% glyph. | Teal refracted shapes, white specular edge. See primary measurement. |
| collection-of-faces_Full-Bleed-Image | Same 13-face collection as calum_2; all ratios above apply. | Confirms multiple distinct themes rather than one huge feature grid. |
| home-touch_big | Nine equal 3×3 cells, gutter ~4–6%, radius ~17–20%. Icons ~27–33% H, name/subtitle nominal ~12% / 10%. | Opaque light grey/lilac panels on white. No evident refraction/edge/shadow. This is a different Home surface; copying it would repeat iter-1's app-grid problem. |
| lifestyle-living-room_big | Six-panel 3×3 face, Climate 2×2; ~5–7% gutters, ~18% radii; numeral ~31% hero height; glyph ~25% cell height. Labels small in photo but same two-line hierarchy. | Blue/purple large forms ~0.5 S, low/medium contrast; fine bright rim. Room photograph too small to quantify shadow. |
| lineup_Full-Bleed-Image | Five devices. Amber Home face still six panels; projected numeral ~30% Climate height, glyph ~25%. Other screens show date, call, photo-clock, music. | Amber Home glass lets broad tonal forms show; no reliable alpha from angle. Other faces opaque/photo. |
| Timer_big | Single centered countdown with peripheral tick ring; numeral ~18–20% S; caption ~5%; ticks ~5% S long. No tiles/gutters. | Black, amber ticks, white Regular time; no glass wallpaper or shadow. |
| Cooking_big | One full photo; two bottom capsule buttons, height ~12% S, gap ~2% S, radius half-height. Title ~5–6% S semibold, caption ~3%. | Clear grey glass over photo, fine white rim and soft shadow; photo detail visible below. |
| Apple-Podcasts-Lyrics-Apple-Music_big | Three media screens; art/title/transport, not a tile grid. Playback glyphs ~4–7% S, title ~5–7%, metadata ~3–4%; lyrics larger. | Full artwork with dark tonal overlay, no geometric wallpaper. Tiny transport rims/shadows not measurable. |
| custom-engineered-acoustic-system_big | Cropped music transport. No tile grid. Glyph ~7–9% S estimated, labels ~4–6%. | Dark artwork field, subtle glass controls; hardware close-up unsuitable for tile measurements. |
| FaceTime-Center-Stage_big | Full video plus small inset ~20% screen width, radius ~15% inset width. No numeral/icon/label sizing applicable. | Photo/video, no glass grid/shadow/wallpaper. |
| Apple-Intelligence-broad-world-knowledge_big | Text + image, no complication grid. Body ~6% S nominal, regular/bold spans; orb ~9% S. | White opaque content, no glass/rim/shadow/wallpaper. |
| Apple-Intelligence-personal-context_big | Three calendar rows under heading. Rows ~10% S height, ~10% S vertical separation; capsule corners; heading ~6% S, row labels ~3%. | White background with pastel opaque rows; no glass/refraction/shadow. |
| Siri-AI-app_big | Text answer plus phone. Paragraph ~6% S, inline image. Not a face; other grid measures N/A. | White opaque text content; no geometric background or tile rim. |
| user-recognition_inline | Launcher overlay: 2×2 app icons and larger Photos widget. Icons ~15–18% screen width, radius ~22% icon width; glyph ~65% icon box; labels ~4% S. | Photo background dimmed/blurred under translucent sheet; different layer from face. |
| lifestyle-dining-room_big | Back/side of device; screen not visible. UI measures N/A. | N/A; physical device shadow only. |
| lifestyle-kitchen_big | Oblique distant cooking view. Ratios unreadable; no trustworthy tile/type measurements. | Warm food art; other material properties N/A. |
| color-family_big | Rear/side hardware lineup. All UI measures N/A. | N/A. |
| rear-USB-C-port_big | Rear hardware. All UI measures N/A. | N/A. |
| screen-angles_big | Edge/back view. All UI measures N/A. | N/A. |
| Apple-Home-Collection-lineup_big | Physical accessories; thermostat 68 is hardware, not a screen-face template. All tile measures N/A. | N/A. |

The supplied contact sheet contains 18 reference thumbnails in 6×3 arrangement. This is an image index, not a UI grid. It confirms teal/purple/amber modular faces, opaque accessible Home view, blue full-screen control, and photo/media views. Its approximately 250–330 px-wide thumbnails are too reduced for independent font/rim measurements, so the original files above were used. No additional layout was inferred from its gutters.

## Web research: primary Apple sources

- [Apple Watch faces and features](https://support.apple.com/en-mt/guide/watch/apde9218b440/watchos): Modular Ultra offers seven complication slots around configurable time. **Mapping/inference:** hierarchy survives density because the time remains dominant; our Climate takes that role. Do not reproduce the watch's edge gauge or tiny seven-slot density at wall distance.
- [Apple watchOS 8 guide, Infograph Modular](https://help.apple.com/pdf/watch/8/en_US/apple-watch-user-guide-watchos8.pdf): up to six complications, including the broad central information block and three small bottom slots. **Mapping/inference:** one expanded data region plus a restrained bottom trio fits the requested Home composition.
- [Apple HIG Complications](https://developer.apple.com/design/human-interface-guidelines/complications): meaningful glanceable state and relevant deep links are the purpose. Circular fits one glyph/value; rectangular fits multiple text rows; corner follows an analog dial; inline is a single compact row. **Mapping/inference:** clock uses circular visual geometry, Wi-Fi a rectangular two-line identity, accessories glyph/name/room, Climate one value plus inline status. Do not literally adopt watch-point dimensions or curved corner text on an iPad. Glyphs must be heavier than hairlines.
- [Apple HIG Widgets](https://developer.apple.com/design/human-interface-guidelines/widgets): accessory families adapt to context; rectangular and circular widgets can appear in the Smart Stack. **Mapping/inference:** preserve useful semantic chunks and a coherent material palette, not one card per available backend feature.
- [Design widgets for Smart Stack, WWDC23](https://developer.apple.com/videos/play/wwdc2023/10309/), [Smart Stack support guide](https://support.apple.com/en-euro/guide/watch/apdecf142fb9/watchos): a second layer makes timely information accessible without crowding the face. **Mapping/inference:** horizontal paging to Controls with honest page dots; no automatic reordering or time-sensitive features invented here.
- [Apple HomeView product page](https://www.apple.com/apple-homeview/) and [Apple Newsroom](https://www.apple.com/newsroom/2026/10/meet-apple-homeview-a-new-way-to-enjoy-entertainment-and-manage-the-home/): named Home Modular face, distinct customizable faces, glanceable home control and tap access. HomeView is the verified product name; “homeOS” is not treated as a separate public layout/API specification. Our design decisions derive from the supplied faces, not an assumed homeOS SDK.
- [Apple HIG Materials](https://developer.apple.com/design/human-interface-guidelines/materials): regular glass adapts luminosity/blur for legibility; clear retains rich background detail. Glass should serve functional controls, not decorate every content layer. **Mapping/inference:** six interactive face surfaces above a procedural background; no nested glass around names/icons. Try clear and regular on-device. Lamps gets an opaque gradient background with glass only on controls.
- [Applying Liquid Glass to custom views](https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views): use `glassEffect`, rounded shapes, `interactive()` and a `GlassEffectContainer`; effects reflect surroundings and blur underlying content. [Clear](https://developer.apple.com/documentation/swiftui/glass/clear) requires attention to foreground contrast; [Regular](https://developer.apple.com/documentation/swiftui/glass/regular) is the default. Our extra white specular stroke is a reference-matching design choice, not an Apple requirement. Avoid a cyan-colored stroke.

Apple HIG/SwiftUI HTML pages exposed Markdown links; web fetch rejected the text/markdown MIME type, so their official `.md` pages were read over HTTPS directly. No third-party technical guidance used.

## Design decisions before coding

```
Home:                       Controls (second page):
┌─────────────────┬───────┐     [Under Cabinet] [Fan] [All]
│                 │ Clock │     same scale and glass; three large controls
│     Climate     ├───────┤
│        70       │ Wi-Fi │
│                 │       │
├────────┬────────┼───────┤
│ Lamps  │ Lamps  │Lights │
│Bedroom │ Living │Ceiling│
└────────┴────────┴───────┘
             ● ○                         ○ ●
```

1. Center a near-square face, aspect ~1.10, inside the 4:3 panel. At 1376×1032 use ~1030×936, ~22-point gutters (~7.4% cell height), cell ~329×297, Climate ~679×617. This follows calum_3's six-panel structure and the front-on purple face; the side margins are intentional space for wallpaper, not more app slots. Controls houses exactly the three moved features.
2. SF Pro Regular Climate font ~46% hero height, yielding ~33% visible ink height; centered horizontally and vertically within the upper area. Use a centered 34-point semibold Climate / 27-point dim A/C status block near the bottom, with chevrons in the lower corners. This corrects iter-1's thin left-aligned figure using both primary refs.
3. Accessory icons ~76 pt (26% H); names 40 pt Semibold (13.5% H); subtitles 28 pt Regular (9.4% H), centered. The final row reads Lamps / Bedroom, Lamps / Living Room, Lights / Ceiling. Wi-Fi uses the same name/subtitle scale. These follow Calum's latest explicit proportions. Controls may reduce only the long Under Cabinet name to fit on one line.
4. Palette: deep teal #064d4b, base teal #126b65, illuminated teal #438f85, dark ink #12302d, warm amber #e8a527, warm controller #9a4d0e to #bd781f. Canvas draws a few oversized curved blades, a large circle and broad arcs spanning 0.4–1.0 S. Slight 2–4 pt softening, not iter-1's 65–85 pt blur. Larger/fewer forms than the reference's fine folds respect the explicit calm-wallpaper request.
5. Radius ~54 (18% small H), same absolute curve on Climate (~9% hero H). Clear/regular A/B on simulator; choose based on actual wallpaper visibility. White top-left edge 60%→0, faint opposing inner edge, no cyan outline; soft black shadow radius 30/y16/27%. Shadow settings are implementation choices, not recoverable photographic constants.
6. ON panels use a much lower white lift than iter-1's 64% base, initially ~28–34%, plus the glass effect; near-black type and amber glyph. Preserve enough wallpaper shape to demonstrate translucency. Retain icon-toggle/body-open semantics and all real data commands.
7. Lamps keeps 220×560 global slider, raises room titles to 28 Semibold, members to 19, group glyph buttons to 164, and uses a deep amber gradient with a radial pool of light behind the slider. The film supplies the saturated full-screen controller language; the actual Lamps layout is explicitly our design, not a claimed reference screenshot. Color & Effects remains the single real secondary entry.
8. Verified `features/ctrl/api.ts` and `service.ts`: brightness affects every lamp and turns them on. `packages/core/src/lights/index.ts` verifies cabinet in Kitchen. Memberships stay captions because there is no individual lamp toggle API in this prototype. Existing fixture-only data remains identified; no additional fake devices/features.

Plan review against the brief: a full-width 4-column grid would repeat the rejected hierarchy. Choose the near-square six-panel Home and separate Controls instead. Keep the clock face circular like calum_3. Do not introduce card headings, decorative chips, new faces, photos or backend features. Render at most three implementation passes, inspect the real simulator, then record the final material choice and remaining mismatch below.
