# Evee native redesign

Actual SwiftUI Panel app on the 1366×1024-point iPad simulator (2× captures).
All values are synthetic fixtures, not a screenshot of the owner's live location
or vehicle telemetry. Artwork is generated; provenance is in
`apps/apple-prototype/docs/evee-artwork.md`.

`TeslaDashboardTests/testVehicleStatesAndPINEntry` captured parked, unlocked,
charging, driving, update available, installing, offline, no power, and the fresh
PIN flow. It verifies the odometer stays visible in every state and lock controls
are disabled while driving, installing or offline. All eight scenarios passed.

`charging-glow.mov` shows the actual charging highlight and glow in a simulator
launched with `-hybridFixtures -hybridMotion -hybridTeslaScenario charging`.
The fill remains at the reported battery level. Normal fixture tests use static
motion; Reduce Motion removes the moving highlight and keeps a steady glow.

No real vehicle commands were sent.
