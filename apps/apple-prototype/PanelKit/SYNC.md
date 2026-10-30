# Native state synchronization (WWW-38)

The server is the source of truth for iPhone and wall iPad state. Each feature
uses short HTTP polls while its scene is active, plus an immediate read on
foreground. There is no WebSocket, subscription, peer-to-peer state transfer or
client-side conflict resolver. Server mutation responses replace optimistic
state; a failed mutation rolls back to the last confirmed state. Mutations are
never automatically replayed by the coordinator.

## Shared coordinator

`SyncCoordinator<State>` is a MainActor, observable PanelKit primitive, retained
once per feature and server/auth configuration. It owns:

- Immediate foreground refresh and one non-overlapping polling loop per feature.
  Repeated active notifications do not start additional loops. Independent
  feature coordinators prevent a slow service from holding up other features.
- A four-second default start-to-start cadence, using `ContinuousClock` rather
  than wall time. Time spent fetching is deducted from the interval. An overrun
  gets a full interval of rest; missed polls never produce a catch-up burst.
- Exponential retry delays after read failures: 8, 16, 32, then 60 seconds by
  default. A successful accepted response resets backoff. Foreground always
  bypasses the current delay. Background cancels the loop and its current read.
- A typed in-memory `lastKnown` snapshot and its `lastSyncedAt`. Failures retain
  both, so a previously confirmed timer can keep rendering while visibly stale.
  Cold launch with no successful response remains unavailable. The cache is not
  persisted, shared between servers, or populated with fixtures/optimistic data.
- A clock offset computed as `serverTime - midpoint(requestSent, responseReceived)`.
  Server timestamps remain unchanged; render elapsed time with `serverNow(at:)`.
  Clock accuracy is approximate (network asymmetry can bias the estimate).
  Endpoints without `serverTime` leave the offset unchanged, initially zero.

`SyncClock` injects wall time, monotonic elapsed time and cancellable sleep as one
unit. Tests advance virtual time; production uses Foundation and ContinuousClock.
The polling callback captures its provider weakly. The provider must check
cancellation and request/revision IDs **before** calling `accept`/`recordFailure`.
This keeps a late poll from overwriting a newer mutation or foreground refresh.
The owner must forward scene changes and stop polling on removal.

## Walk adoption

`Sources/Live/LiveWalkProvider.swift` delegates polling, clock correction and the
confirmed active-state cache to the coordinator. Its existing API, mutation
optimism/rollback, explicit retry UUID, history mapping, ActivityKit observation
and stale-response guards remain in place. A `clock:` initializer argument is
optional; existing `now:` and `pollInterval:` injection still work. Default
polling changes from five seconds after each read to a four-second start cadence,
leaving one second for a healthy request in the five-second propagation target.

Both active clients read `walks.state`; the first successful poll after a remote
start adopts the same ID and server start timestamp. Synthetic two-client tests
use the real `WalksAPI` HTTP decoding, clocks offset by -120/+90 seconds and a
shared server. They prove iPhone-to-iPad **and** iPad-to-iPhone propagation at four
virtual seconds, equal elapsed times, remote stop and history reconciliation.
Other tests cover midpoint correction, offline retention/backoff, foreground
refresh, cancellation, stale reads and ActivityKit behavior. The five-second
objective assumes active scenes and a responsive server/network; suspension,
offline backoff and requests longer than the latency budget cannot meet it.
There are no background push-to-start/update guarantees.

The WWW-27 contract already includes `updatedAt` and `serverTime` on
`walks.state` and mutation responses. The provider compares `updatedAt` **and** the
active record (timestamps have millisecond precision), fetching history only
when dirty, after a mutation or on foreground. No new backend PR is needed.
ETag/304 support and additive version/timestamp fields on other state endpoints
are follow-ups: they need an API/client contract and must not rename/remove
existing fields. ETags should represent state versions, not the changing
`serverTime`; a 304 needs a defined time-sample strategy.

## Hybrid host and rollout

`PanelModule.walk` is reserved with the same default `web` as every other module.
The existing router selects native only for `native` **and** `hasLiveData`.
Exact opt-in launch argument: `-moduleFlag.walk native` (reset with
`-moduleFlag.walk web`). No production flag was flipped.

**Current base limitation:** at app base `4f124a17`, WWW-44's `LiveHomeDataSource`
and `HybridNativeModule` are not present. The root still mounts the web board,
and the prototype still owns its mock providers. This PR adds no native view
or composition replacement: flipping the walk flag alone still shows web.
WWW-44's separate branch currently wires six other modules and reports walks
unavailable. After that composition lands, the host must retain one
`LiveWalkProvider` with `WalksAPI(client:)`, expose it as `store.walks`, retain
`WalkActivitySync` on iPhone, and forward `scenePhase == .active` (and false on
removal) to `setSceneActive`. Select native only when the walk flag is native,
`hasLoadedState` is true and `availability == .live`; a confirmed idle walk is
valid live data. Missing endpoint, missing config or a failed read selects web.
Do not interpret cached/optimistic state as permission to show the native route.
Views must use the provider's corrected server time for elapsed-time rendering.

## Adopting other providers

1. Retain `SyncCoordinator<FeatureState>` alongside the existing feature API,
   scoped to the same server and credentials. Select a suitable interval (alarms
   may need one second; weather can remain much slower). Do not run its old
   polling loop alongside the coordinator.
2. On an accepted read or mutation response call
   `sync.accept(state, serverTime: state.serverTime, sentAt: sentAt)`; omit
   `serverTime` where the endpoint has none. Project `lastKnown` into existing
   view models and expose freshness separately from data availability.
3. After a non-cancelled current read failure, call `sync.recordFailure()` and
   report unavailable while retaining confirmed state. Keep provider-specific
   pending commands, idempotency keys, history and revision guards in the adapter.
4. Forward lifecycle with
   `sync.setSceneActive(active) { [weak self] in await self?.refresh() }`.
   Invalidate outstanding response IDs on scene transitions; never cancel or
   silently retry a submitted mutation just because the scene backgrounds.
5. Keep WWW-18's native-flag/live-data gate and web fallback. Test timing with
   a fake clock, plus late-response/mutation ordering with a held transport.

Alarm bridge/ActivityKit parity (WWW-47) and other live providers retain their
current polling behavior until explicitly adopted. This coordinator introduces
no backend, web, Expo shell, CI or design-view changes.

## Verification recorded on 2026-10-30

Xcode 27.0, isolated `~/wwwebb-state-sync`, derived data
`~/wwwebb-state-sync-dd`, dedicated `WWW-38 State Sync iPad` (iOS 26.3):

- `cd PanelKit && swift test --jobs 2`: 41 tests passed.
- `/opt/homebrew/bin/xcodegen generate`, then one serial test invocation using a
  temporary generated `WWW-38-StateSync` scheme combining PanelTests and the
  app's WorldWideWebbTests testable (no tracked project change):

  ```sh
  xcodebuild test -project WorldWideWebb.xcodeproj -scheme WWW-38-StateSync \
    -destination 'platform=iOS Simulator,id=<dedicated-device-UUID>' \
    -derivedDataPath ~/wwwebb-state-sync-dd -parallel-testing-enabled NO -jobs 2 \
    CODE_SIGNING_ALLOWED=NO -only-testing:PanelTests \
    -only-testing:WorldWideWebbTests/LiveWalkProviderTests \
    -only-testing:WorldWideWebbTests/DogWalkProviderTests
  ```

  36 Panel tests and 22 walk tests passed. The shared `~/bin/www8-simlock`
  serialized simulator use. The final fixture explicitly encodes nullable
  `endedAt`, matching WWW-27; CI checks that final fixture revision.
- Repository `bun run typecheck`, tracked lint, Knip, privacy and secret guards
  passed. Evidence: `docs/screenshots/state-sync/verification.png` at repo root.

No authenticated live-server or physical-device checks were performed. These
are data-layer and policy tests; there is no new screen to capture.
