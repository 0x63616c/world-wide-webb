**Home: 8.3 — does not clear 9. Lamps: 8.2 — does not clear 9. Clock-near: 8.8 — does not clear 9.**

I reviewed the eight live simulator captures, the relevant local references, and [APPLE-SPEC.md](/tmp/www8-review-4b/APPLE-SPEC.md), with iteration 4/4b taking precedence. No source code was read. The mixed spans, photograph, regular glass, warm active surfaces, and playback scrubber are intentional—not defects.

| Render | Score |
|---|---:|
| [Controls](/tmp/www8-review-4b/sim-controls.png) | **7.8** |
| [iPhone Home](/tmp/www8-review-4b/sim-iphone-home.png) | **8.0** |
| [iPhone Home, scroll end](/tmp/www8-review-4b/sim-iphone-home-bottom.png) | **8.0** |
| [Now Playing](/tmp/www8-review-4b/sim-nowplaying.png) | **8.1** |
| [Lamps](/tmp/www8-review-4b/sim-lamps.png) | **8.2** |
| [Home](/tmp/www8-review-4b/sim-home.png) | **8.3** |
| [iPhone Now Playing](/tmp/www8-review-4b/sim-iphone-nowplaying.png) | **8.4** |
| [Clock-near](/tmp/www8-review-4b/sim-clock-near.png) | **8.8** |

Concrete flaws, worst first:

1. **Home’s brightness control does not adequately communicate scope.** Both Home compositions combine “65%” with “3 of 8 on,” without explaining whether adjustment affects those three lamps or all eight. Lamps detail explicitly says adjustment turns everything on. That consequence is missing where Home presents the same kind of control.

2. **Lamps breaks the active-state language established elsewhere.** Bedroom is on, but its surface remains almost identical to the off Living Room surface. Orange symbols carry the distinction. Home’s Lamps and Controls’ Under Cabinet use the light warm surface with dark foreground specified by 4b; Bedroom does not visibly follow that treatment.

3. **Controls truncates an ordinary fixture title unnecessarily.** “Closer to the S…” is an obvious unfinished detail. The tile has substantial vertical room: a two-line title could preserve the actual track name. Shipping-quality typography should handle this known content.

4. **The phone Home loses the All lights shortcut.** The top and scroll-end captures together establish that it is absent from this page, rather than simply below the fold. The compact composition therefore sacrifices a useful control available on iPad.

5. **Controls’ weather illustration has the weakest visual finish.** The clouds read as blurred overlapping blobs, and the sun has a conspicuous soft halo. The extremely crisp cyan perimeter makes that softness more apparent. The large empty middle also disconnects the temperature from the condition information. The required 2×2 span is correct; its internal composition needs work.

6. **iPad Now Playing underuses the landscape canvas.** Artwork and the main control stack occupy approximately 400 pt of a 1376-pt-wide screen. Huge side fields remain empty while the room header sits far above the artwork. Compared with [Calum 5](/tmp/www8-review-4b/refs/calum_5_music_player.png), the artwork has substantially less command of the composition.

7. **Lamps does not clearly separate power from navigation.** Each room surface combines a room identity, power symbol, state/count, and “Show lamps” action without strong grouping. The grey Living Room power symbol also resembles a disabled action, although the room is merely off. The screenshot leaves too much interpretation around the two actions.

8. **The phone scroll-end capture exposes an abrupt top clipping edge.** The Lamps surface is cut across a perfectly horizontal boundary beneath an empty wallpaper band. There is no visible navigation surface or softened scroll-edge treatment to make that cutoff feel resolved.

9. **Home’s secondary information is too close to primary information in emphasis.** “Inside 72° · Cooling,” artist, room, and accessory states remain almost equally white. Size and weight provide some hierarchy, but the result is flatter than the hierarchy demonstrated in the [Apple Home reference](/tmp/www8-review-4b/refs/iphone-home-26-6.png). Controls uses noticeably different secondary-text treatment, exposing the inconsistency.

10. **The Home brightness fader casts an excessively broad, muddy shadow.** This affects iPad and both phone Home views. The grey-brown cloud beneath the white instrument dominates the lower warm surface. It exceeds the spec’s restrained separation and makes the fader look unnecessarily raised.

11. **iPhone Now Playing makes the artwork too small relative to its text.** The artwork is approximately 221 pt wide, while the track information and scrubber span approximately 354 pt. The large title and generous surrounding gaps make typography compete with the supposedly artwork-led presentation. The phone reflow is real, but its proportions need another pass.

12. **Lamps’ important explanatory text is spatially disconnected.** “Adjusting turns all lamps on” sits below the entire tall instrument, far from the value and scope label that establish what the adjustment means. The information exists, but its placement and subdued treatment weaken it.

13. **Lamps is noticeably top-heavy.** The working composition finishes around the upper three-quarters of the screen, followed by a large empty region and an isolated fixture marker. The two columns are coherent individually, but their placement within the full canvas feels insufficiently balanced.

14. **Accessory naming and state wording drift between pages.** Home has “All lights / Some on”; Controls has “All / Some lights off.” Home’s “Fan / Auto” becomes “Fan / A/C · Auto.” “Ceiling” supplies no room context. These are small strings, but they prevent the screens from feeling like one carefully edited product.

15. **Clock-near’s cardinal numerals need optical positioning.** The gap from the spindle to the top of the **6** is approximately 105 pt; the gap to the bottom of **12** is approximately 150 pt. Consequently, the 6 presses toward the centre while 12 floats farther away. The oversized numeral concept is correct; the vertical balance is not finished.

16. **Clock-near’s seconds hand is too faint at this scale.** It becomes a barely visible hairline against the green, especially beside the substantial hour and minute hands. It needs stronger visibility while retaining the required monochrome treatment.

17. **The equalizer receives too much emphasis in the phone layouts.** On phone Home it competes with the track metadata; on phone Now Playing its bright, relatively large bars overpower the subdued Spotify label. Playing-state indication should remain subordinate to content and destination.

18. **The phone captures omit the specified fixture marker.** It is visible on the iPad screens but absent from both phone Home positions and phone Now Playing. That is a visible spec-compliance omission, separate from visual polish.

19. **Home’s header sits over unnecessarily busy photographic detail.** Branches run directly behind “Home.” The text remains readable, but this part of the composition lacks the controlled backdrop given to every tile below it.

**Bottom clearance passes.** In the phone scroll-end capture, Clock and Guest Wi-Fi are fully visible, with approximately **34 pt between the final row and the pager**. There is no bottom-overlap deduction.

The iPad Home spans and gutters are correct; Lamps’ fill matches 65%; the playback position correctly represents 1:47 of 3:52; and Clock’s alarm and complications stay clear of the dial. Those fixes deserve credit. The remaining issues are sufficient to withhold 9, with Clock-near closest.