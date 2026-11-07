# Pass 7g: restore accepted composition, correct live geometry

The 7f structural experiment regressed. Restore the seven-module Home with the wide Weather tile, the tall Sonos summary on More, and the Climate/Weather/Up Next first phone viewport. Retain the tested 24-point phone gutters and complete Music card at the bottom scroll stop. Restore the native light active/dark inactive regular glass treatment; no custom tile rim or fill.

The live window test exposes a 12.5-point upward translation introduced by the page TabView, despite correct solver frames. Anchor the fixed panel grid at the top of the page's proposed frame; verify equal live header, side and bottom margins above the 80-point pager.

The phone scroll mask hides the preceding card but its system glass can still contribute a reflected shelf. Cull tiles wholly inside the clear edge strip using ScrollGeometry.visibleRect, without changing content size or scroll positions. Keep the eight-point soft edge. Add a unit check for the bottom stop's visible tile set. Scale the brightness sun to 32 points on the 64-point phone fader, with a 16-point bottom inset; full-screen instrument remains unchanged.

Accepted full Lamps, Clock, Music and Walk detail compositions are retained. All five schemes and eight UI tours must pass before committing; capture all twelve live screens twice, validate and score with the unchanged three-run method. Baselines remain unchanged pending acceptance.

API reference: https://developer.apple.com/documentation/swiftui/view/onscrollgeometrychange(for:of:action:) — transform geometry into an Equatable visible-ID set, so state updates only when membership changes.

## Verified implementation

The final fix wraps only the fixed Home/More canvas in a top-origin GeometryReader. The original safeAreaBar and other faces are retained; the two safe-area experiments did not move the live bounds and were removed. Both Home and More now measure left/top/right80 and bottom79.75 points, within the 0.5-point test tolerance.
