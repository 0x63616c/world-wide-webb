# Clock alarms

Tap the existing Clock tile to create, edit, enable, disable, or delete alarms.
Clock is also first on phones. Alarm detail uses the shared full-page host;
the panel board remains 1366×1024.

Alarms have a label, wall-clock time, saved IANA time zone, optional date, and
repeat weekdays. No date/days means the next occurrence, once. Date-picker
values use the selected zone, not the browser's zone. Shortcuts can supply an
exact ISO 8601 instant in `at`. Changing the panel's zone preference does not
silently move existing alarms.

## Configuration

The central env registry declares all defaults. Each alarm can override its
light target and snooze duration in the editor.

| Setting | Default | Use |
| --- | --- | --- |
| `ALARM_LIGHT_TARGET` | `light.bed_lamp_left,light.bed_lamp_right` | Comma-separated `light.*`/`switch.*` entities, or one `scene.*` |
| `ALARM_SNOOZE_MINUTES` | `9` | Integer, 1–60 minutes |
| `ALARM_API_TOKEN` | Unset; HTTP automation returns 503 | Dedicated bearer token, at least 32 characters |
| `HA_URL`, `HA_TOKEN`, `DATABASE_URL` | Existing configuration | HA and Postgres transport |

Override non-secret defaults on **both API and worker**. Their shared workload
env lives in `infra/src/services.ts` (`haEnv`).

Before deploying, provision `PANEL_ALARMS__TOKEN` through the existing SOPS
secret workflow. The platform catalog maps it to API `ALARM_API_TOKEN`; the
worker does not receive it. A missing vault key prevents provisioning the API
Secret; an empty token disables HTTP automation. Never commit plaintext tokens.

The iOS build workflow supplies the same token plus the existing
`CF_ACCESS_KIOSK_CLIENT_ID` and `CF_ACCESS_KIOSK_CLIENT_SECRET` to Expo config.
Set these environment variables for local native builds. Credentials follow
the shell's existing build-time config convention and are stored in device-only
Keychain storage for App Intents. They are not sent to the hosted web page or
the widget extension.

## Reliability

`features/events` owns the manifest, detail, API, HTTP, schema, and interval
worker facets. Migration `0041_sparkling_gravity.sql` creates `alarm` and
`alarm_ring` through the existing API/worker migration boot path.

The worker runs every second and at startup. A transaction locks due definitions
with `FOR UPDATE SKIP LOCKED`, inserts a unique `(alarm_id, scheduled_at)`
occurrence, and advances/disables the schedule together. Concurrent workers and
restarts cannot create a second occurrence. There is no new job queue.

Occurrences within 15 minutes are recovered. Older backlog is skipped and
recorded as missed; a recent repetition can still fire after a multi-day outage.
Nonexistent spring-forward times are skipped; repeated fall-back times fire
only at their first instance. Repeats advance by calendar day in the saved zone.

The global web runtime polls every second, wakes the panel, and rings through
the shared sound bus. Snooze is persisted. Versioned Snooze/Stop actions reject
stale clients and double taps. Saving an edit, disabling, or deleting stops the
current ring/snooze. Rings expire after 30 minutes; snoozes receive 30 minutes
from their new due time. Snoozes also appear in the next-alarm countdown.

HA retries with bounded exponential backoff in a separate interval cycle, so
slow light delivery cannot stall alarm scheduling. Managed
lights update the shared desired-state store so the light enforcer preserves
the alarm command. Scenes adopt HA's returned states for managed light members.
Only `turn_on`/scene activation is supported, never toggle. The occurrence is
exactly once; HA may receive an idempotent retry after a crash between accepting
the command and committing delivery. Use ordinary lighting scenes without
non-idempotent automation side effects.

The wall-panel WebView must be open for web audio. Browsers need an initial
gesture to unlock audio; device volume controls loudness. The Expo shell
permits unattended playback and silent-mode audio. Server lights work without
an open panel. Local verification deliberately does not actuate household devices.

## Siri Shortcut

1. Create a Shortcut named **Panel alarm**. Add **Ask for Input**, choosing
   **Date and Time**, then **Format Date** with ISO 8601 output and its offset.
2. Add **Get Contents of URL**: POST
   `https://app.worldwidewebb.co/api/alarms`, JSON body with `at` set to the
   formatted date and `label` set to the desired alarm label.
3. Add `Content-Type: application/json` and
   `Authorization: Bearer <your ALARM_API_TOKEN>` headers.
4. The hostname also requires Cloudflare Access. Add an authorized service
   token's `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers. These are
   separate authentication layers. Do not share a Shortcut containing credentials.
5. Optionally generate a UUID once per invocation for `Idempotency-Key`; reuse
   it for retries of that same request. Check the response before announcing
   success: HTTP 201 returns `id` and `nextFireAt`.
6. Say **“Hey Siri, Panel alarm”**, then answer **“9 AM”**. Choose a future
   date/time; past absolute dates are rejected.

A time-only alternative uses the installation's zone:

```json
{"label":"Morning","time":"09:00","repeatDays":[1,2,3,4,5]}
```

Sunday=0 through Saturday=6. Optional fields: `timeZone`, `snoozeMinutes`, and
`lightTarget`. `at` cannot repeat. Identical requests with the same idempotency
key return the original alarm; changed bodies return 409. Keys last for the
alarm's lifetime. Invalid JSON/fields return 400, wrong bearer tokens 401,
unconfigured automation 503. Request bodies are limited to 8 KiB.

Authenticated `GET /api/alarms` returns the snapshot. Authenticated
`POST /api/alarms/action` accepts `{id, version, action: "stop" | "snooze"}`.

## Native Siri and Live Activity

The local module lives at `apps/panel/modules/panel-alarms`.
`plugins/with-panel-alarms.js` adds checked-in Swift sources, the
`NextAlarmWidget` target, embedding, and dependencies on every clean prebuild.
Never hand-edit generated `apps/panel/ios` files.

Open a configured native build once. Shortcuts then exposes **Control Center →
Create panel alarm**, with date/time and label parameters. **“Set an alarm in
Control Center”** prompts for the time. The intent opens the app, uses the same
HTTP service, and reports success only after the server saves the alarm.

The ActivityKit extension shows the next alarm's label, time, and system-ticked
countdown on the Lock Screen and compact/expanded/minimal Dynamic Island.
Tapping it opens Alarms. Foreground web changes and native foreground refreshes
update/end it; the displayed countdown continues when JavaScript suspends.

ActivityKit provides presentation here. AlarmKit would create an independent
device-local ringing schedule and dismissal state, so this change deliberately
does not schedule a second alarm or provide iPhone background ringing.

There is no APNs activity-update service: remote edits while this app is
suspended appear on the next foreground refresh. Standard ActivityKit limits
apply (up to eight hours active, then up to four more hours on the Lock Screen).
iOS can dismiss activities, and users can disable them. Reopening restores the
next alarm from the server. These limits do not affect server lights or the
awake wall panel. Apple references: [Live Activities](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities)
and [AlarmKit lifecycle/actions](https://developer.apple.com/videos/play/wwdc2025/230/).

### Before shipping on iOS

Linux validates prebuild/module discovery/target wiring; it cannot compile or
exercise ActivityKit/AppIntents. Verify on macOS and an iOS 26+ device:

- Run `bun run ios:prebuild` and the unsigned Xcode build in the iOS workflow.
- Provision `co.worldwidewebb.theworkflowengine.NextAlarmWidget` alongside the
  app. Matchfile/Fastfile sign targets separately. Use the existing profile
  regeneration workflow for the first extension build. Verify archive/export
  includes both targets with matching build numbers.
- Invoke Siri and the Shortcut, including network/auth failures and retries.
- Check Lock Screen, all Dynamic Island presentations, deep linking, foreground
  edit/delete/snooze updates, background countdown, foreground refresh after
  remote changes, disabled activities, and activity expiry.
- Check actual kiosk dim/wake, device-volume audio, Snooze/Stop, and real HA
  light/scene activation on the home installation.

## Checks

```sh
bun install
bun run apps:gen
bun run apps:check
bun run test
bun run typecheck
bun run lint
bun run knip
bun run --cwd apps/panel prebuild --no-install
```

Set `ALARM_TEST_DATABASE_URL` to a disposable local Postgres URL when running
tests. The contract suite creates its own schema using the real migration;
otherwise it is explicitly skipped. It covers concurrency, restarts, CRUD,
snooze, expiry, missed alarms, stale actions, and light retries. Domain, API,
HTTP, lighting, audio cancellation, and UI tests are hermetic.

Local result: **165 files / 1,693 tests passed**, with both
`ALARM_TEST_DATABASE_URL` and `CORE_PG_TEST_URL` pointing at disposable Postgres.
Typecheck, Biome, Knip, and generated-file drift checks passed. Clean and repeated
Expo prebuilds passed, with module discovery and an explicit widget build
dependency/embedding checked. The browser exercised real HTTP creation, worker
firing, panel Snooze, and HTTP Stop.

for local verification; screenshots do not claim physical device actuation.
