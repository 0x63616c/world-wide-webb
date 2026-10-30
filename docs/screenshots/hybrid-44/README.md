# WWW-44 hybrid module captures

Captured from the actual `Panel` app built from implementation commit `462fd09c`
on 2026-10-30 with Xcode 27.0, using the dedicated `WWW-44 Hybrid iPad`
simulator (iOS 26.3). Images are 2732×2048 pixels, representing the fixed
1366×1024-point panel at 2× scale.

The isolated checkout is `~/wwwebb-hybrid-44/` on `calum@homelab`, with derived
data in `~/wwwebb-hybrid-44-dd/`. No design-worker checkout or simulator was used.

`apps/apple-prototype/scripts/capture-hybrid.sh` launched each module with
`-hybridFixtures -moduleFlag.<module> native`; detail captures also used
`-hybridDetail`. The debug transport supplies existing synthetic PanelKit JSON
fixtures to the real providers, with no network fallback or real credentials.
The script waits for a marker from mounted fixture content before capturing.

`default-web-board.png` has no native flag. `unavailable-web-fallback.png`
requests native Lights and forces provider unavailability. Both show the real
web shell's offline recovery overlay against fixed loopback, not an authenticated
home board. The fan has no separate controller, so its detail reuses its tile.

All 12 composition tests and all 27 PanelKit tests passed on the mini; Panel and
the existing macOS app built. The local XCTest UI runner exited before bootstrap,
so these are direct simulator captures, not evidence of executed UI assertions.
See the PR for hosted CI results and the exact presentation injection seams.
