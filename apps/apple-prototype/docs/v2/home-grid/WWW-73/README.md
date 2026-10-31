WWW-73 captures use the real app and live-provider decoders with the existing
synthetic test fixtures, never a service or a personal account.

The Panel page-2 pair comes from the mounted `HomeViewIntegrationTests` grid,
recorded by `simctl` during the test's capture markers. Both use the same clock
and providers. Before uses a legacy integration whose default grid hook returns
nil; after uses `PanelHomePresentation`. Now Playing changes from the generic
prototype artwork to the Panel host's authenticated artwork and metadata.
Camera snapshot failure and the locked Photos launcher retain host behavior.
The legacy page-2 modules remain for WWW-72 to replace.

The test also exercises both pages, unavailable-source precedence and refreshed
fan state. The Home launch smoke test uses `-hybridClimateOff` and checks that
`toggle-fan` still reports On, while both fan and light actions stay on Home.

Prototype page 1 (`-snapshot -face home -wallpaper black`) and page 2
(`-snapshot -face controls -wallpaper black`) were captured on the owned
1376×1032 pt simulator. Both passed the live PNG validator. Independent repeated
launches differed by 0.073056/255 and 0.000254/255 respectively (limit 0.5/255).
The page-2 PNG is also copied to `/workspace/shots/WWW-73-home-page2.png`.

Homelab verification used Xcode 27 and derived data in `~/wwb-WWW-73-dd`:

- `xcodebuild test -scheme Panel -only-testing:PanelTests -only-testing:WorldWideWebbTests`: exit 0, 120 Panel tests and 152 iPad tests passed.
- Focused `PanelTests/HomeViewIntegrationTests`: exit 0, 4 tests passed; the final compositor capture test also passed.
- `xcodebuild test -scheme WorldWideWebb-iPad` selecting `PrototypeUITests/testGridHomeIsCenteredOnBothPages`, `testGlyphTogglesWithoutOpeningAndClimateModes`, and `testHomeNavigationFromBothFaces`: exit 0, 3 tests passed after one retry following a simulator automation idle-notification stall.
