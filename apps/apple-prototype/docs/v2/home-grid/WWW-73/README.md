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
