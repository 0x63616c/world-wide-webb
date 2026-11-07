> Historical reference from before the native/Rust reset. Current operations and source locations are
> defined by `CODEBASE_OVERVIEW.md` and `docs/runbooks/native-rust-cutover.md` at the repository root.

# Evee native redesign

Actual SwiftUI Panel app on the 1366×1024-point iPad simulator (2× captures).
All values are synthetic fixtures, not a screenshot of the owner's live location
or vehicle telemetry. The car uses a simple gray pictogram with empty dark windows and no seats. Artwork is generated; provenance is in
`apps/apple-prototype/docs/evee-artwork.md`.

`TeslaDashboardTests/testReadOnlyVehicleStates` captured parked, unlocked,
charging, driving, update available, installing, offline and no power. It verifies
the mileage stays visible, the lock indicator reports the fixture's actual state,
and there is no lock button, toggle or PIN entry in any state.

`charging-glow.mov` shows the actual charging highlight and glow in a simulator
launched with `-hybridFixtures -hybridMotion -hybridTeslaScenario charging`.
The fill remains at the reported battery level. Normal fixture tests use static
motion; Reduce Motion removes the moving highlight and keeps a steady glow.

No real vehicle commands were sent.
