# Clock alarms

Extended the existing `features/events` Clock tile with full-page alarm
management and placed Clock first on mobile. Added Postgres schedules and
durable occurrences, a restart-safe worker, configurable HA lights/scenes,
panel ringing with Snooze/Stop, authenticated Siri HTTP endpoints, an Expo
App Intent, and an ActivityKit Lock Screen/Dynamic Island countdown.

Verified: **1,693 tests passed across 165 files**, including Postgres tests;
typecheck, Biome, Knip, and codegen checks all passed. Real browser verification
covered HTTP creation → worker firing → panel Snooze → HTTP Stop.

Run `bun run apps:check`, `bun run test`, `bun run typecheck`, `bun run lint`,
and `bun run knip`. Set `ALARM_TEST_DATABASE_URL` and `CORE_PG_TEST_URL` to a
disposable Postgres URL to include all database tests. Check native wiring with
`bun run --cwd apps/panel prebuild --no-install`.

Siri: name a Shortcut **Panel alarm**, ask for a date/time, format ISO 8601,
and POST `{"at":"<formatted date>","label":"Alarm"}` to
`https://app.worldwidewebb.co/api/alarms`. Include the dedicated bearer token
and Cloudflare Access service-token headers. The native app also exposes
**Create panel alarm** after opening a configured build once.

`ALARM_LIGHT_TARGET` defaults to the two bedside lamps;
`ALARM_SNOOZE_MINUTES` defaults to 9. Provision `PANEL_ALARMS__TOKEN` before
deployment. Per-alarm overrides are available in the editor.

iOS needs macOS/Xcode compilation, widget provisioning, and device verification.
Clean/repeated Expo prebuild and local-module discovery passed on Linux.
ActivityKit mirrors the server; it does not create a second AlarmKit alarm or
ring an iPhone in the background. Remote edits refresh on foreground, and
ActivityKit lifetime limits apply.

See [docs/alarms.md](docs/alarms.md) for setup and verification details, and
[screenshots](docs/screenshots/clock-alarms) for the real local UI.
Work is committed locally on `feat/clock-alarms`; no push, PR, merge, or deployment.
