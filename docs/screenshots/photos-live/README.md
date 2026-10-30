# WWW-35 Photos verification

Captured from the running Panel app at implementation commit `e40236ab`, using
Xcode 27.0 and the dedicated `WWW-35 Photos iPad` iOS 26.3 simulator on 2026-10-30.
The raw simulator PNGs are 2732×2048 pixels: the 1366×1024-point panel at 2×.

All images and metadata are synthetic fixtures. The color grid is a generated
test bitmap; no personal photos, PINs or credentials were used. The real
LivePhotosProvider and PanelAPIClient decode the bundled API fixtures and fetch
image bytes through the injected transport.

- `photos-tile.png`: filtered booth capture on the native frame.
- `photos-cycle.png`: next wake photo after the automatic 12-second advance.
- `photos-detail.png`: booth capture, clear-filter and whole-capture removal.
- `photos-pin.png`: a fresh private PIN gate before image display.
- `photos-fallback.png`: unavailable provider returns to the actual web shell's
  offline recovery surface, configured to fixed loopback in fixture mode.

Launch arguments:

```text
-moduleFlag.photos native -hybridFixtures -photosFixturePIN 135790
```

Add `-hybridDetail` for details. Omit `-photosFixturePIN` for the PIN gate. Add
`-hybridUnavailable` for the unavailable fallback. The fixture PIN is synthetic;
the argument is debug-only and submits it through the real settings.get gate.
The own simulator was physically rotated to landscape before capture.

Verification passed: 48 PanelTests, 102 WorldWideWebbTests, and PanelKit's
5 XCTest + 35 Swift Testing tests. This includes default-web/empty-data routing,
PIN rejection/relocking, locked image/mutation guards, wake read-only behavior,
cache hits and on-disk reuse/eviction, exact mutation bodies and Access headers,
unavailability and recovery. Repository typecheck and push hooks also passed.
These direct captures are visual evidence; no UI automation or authenticated
physical-wall check was run.
