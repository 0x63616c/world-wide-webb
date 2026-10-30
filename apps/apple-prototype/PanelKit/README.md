# PanelKit live Lights data layer

Foundation-based Swift 6 package (iOS 17 / macOS 14), with conditional Security
support for Keychain. The app adapter is in `../Sources/Live/`. It is opt-in:
the existing app and previews still use `MockHomeDataSource`. Constructing the
adapter does not start requests; call `refresh()` or `startPolling(every:)`.
Polling defaults to 30 seconds. Call `stop()` when the owner stops using it.

## Configuration

Set `WWW_PANEL_API_URL` to the API origin, for example
`https://panel.example.invalid`. An optional base path is supported; do not
append `/trpc`. HTTPS is required except for localhost/loopback development.
URLs with credentials, queries, or fragments are rejected.

Cloudflare Access uses `WWW_CF_ACCESS_CLIENT_ID` and
`WWW_CF_ACCESS_CLIENT_SECRET`. Both must be present to send the two Access
headers, matching the panel shell. `PanelConfiguration.fromEnvironment()`
reads only the environment. `PanelConfiguration.resolve()` reads the same
URL and credentials first, then fills each missing credential from Keychain.
There is no default deployment URL and the URL is not stored in Keychain.
An absent/invalid URL resolves to nil; the client then throws `notConfigured`.

On Apple platforms, use `PanelKeychain.save(_:for:)` and `load(_:)` with
`.accessClientID` / `.accessClientSecret`. These generic passwords use service
`co.worldwidewebb.panel`, with the environment variable names as accounts.
Passing nil to `save` deletes the item. Items are available after first unlock,
device-local, and not synchronized. The throwing Keychain API exposes status
codes, never credential values; resolution treats an unreadable item as absent.
Supply values from the environment or secure provisioning, not source code.
Configuration descriptions redact the URL and both credentials.

```swift
let client = PanelAPIClient(configuration: PanelConfiguration.resolve())
let api = LightsAPI(client: client)
// In the app, on MainActor:
let provider = LiveLightsProvider(api: api)
await provider.refresh()
```

`PanelConfiguration` also accepts an explicit request timeout (default 30
seconds). Tests inject `PanelTransport`; production defaults to URLSession.
No tests contact the API or read/write the real Keychain.

## Verified contract and mapping limits

The contract comes from `features/ctrl/api.ts`, `service.ts`, `schema.ts`,
`lamp-scenes.ts`, and `api.test.ts`, cross-checked with the web tRPC client,
API initialization, panel Access headers, and nginx's `/trpc` proxy. It is tRPC
v11 without a transformer. Queries send a single percent-encoded JSON `input`
parameter (omitted when absent); mutations send the input object as plain JSON.
Every Lights method returns the full `ControlsState` from `result.data`.
HTTP failures and structured tRPC errors remain distinguishable.

- Toggle keys are `lamps`, `lights`, `fan`, `bedroomLamps`, `otherLamps`,
  `ceiling`, `cabinet`, `all`. Brightness is an integer 0–100, white kelvin
  2000–6500. Scenes are white/mood/red/blue; returned active scene additionally
  allows party or null. Color slots are red/blue/custom, with optional `#RRGGBB`.
  Modes are none/party, with optional slow/medium/fast speed.
- Bedroom indices `0..<3` follow `bedroomLamps.on`; Living Room indices `3..<8`
  follow `otherLamps.on` (which includes Kitchen). These flags mean *any member
  on*. The API has no per-lamp state, so displayed individual membership/counts
  can overstate how many are on. `lamps.count` is retained in the DTO. The
  adapter uses the server's `all.on` for an idle All toggle, because AND across
  real lamps cannot be reconstructed from the two OR group flags.
- Ceiling/cabinet, brightness, white kelvin and saved colors map directly.
  Saved colors map by slot, independently of array order; labels are retained
  in the DTO because `LampState` has no label fields. The server retains last
  desired brightness when all lamps are off, despite the schema's older
  “0 when none on” description.
- Fan belongs to the A/C, not `LampState`. `fanOn` is nil until a server
  snapshot arrives; `.toggle(.fan)` sends key `fan`. Its speed/sub-label stays
  in the DTO because this adapter exposes only fan power.
- The response has no party speed, selected saved-color slot, or per-lamp
  colors. Party uses only the last speed successfully requested by this
  provider, retaining `.off` if unknown; `scene` still reports `Party`.
  `lampColors` remains unchanged. A null scene retains the last confirmed
  scene string (initially the fixture's `White`); no saved-color selection is
  inferred, and `activeColor` clears when a server snapshot arrives.
- Pending uses API keys, not accessory aliases: `bedroomLamps`, `otherLamps`,
  etc. Lamp settings use `lamps` while locally in flight. Current server code
  reports pending only for fan; all other server flags are false. The adapter
  nevertheless maps every flag for compatibility.

Mutations are serialized, with queued optimistic edits reapplied after each
response. A stale refresh cannot overwrite a newer command. A failed mutation
discards the remaining queue, restores the last confirmed snapshot (or the
initial fixture before the first success), and marks availability unavailable.
`stop()` cancels local work and restores confirmed data; a later refresh
reconciles any request the server had already accepted. Recognized commands
return true (including brightness/party no-ops while off); other commands and
invalid scene/color inputs return false. The package validates exact input
ranges, while the app adapter clamps brightness/kelvin controls to those ranges.

## Tests

Run on the build mini with Xcode 27, from the isolated copy of this app at
`~/wwwebb-live/WWW-11`. Use only the separate `WWW Live iPad` simulator (iOS 26.x).

```sh
export DEVELOPER_DIR=/Applications/Xcode-27.0.app/Contents/Developer
cd ~/wwwebb-live/WWW-11/PanelKit
swift test
cd ..
/opt/homebrew/bin/xcodegen generate
xcodebuild -scheme WorldWideWebb-Snapshots \
  -destination 'platform=iOS Simulator,name=WWW Live iPad' \
  -derivedDataPath ~/wwwebb-live/dd -parallel-testing-enabled NO \
  -only-testing:WorldWideWebbTests CODE_SIGNING_ALLOWED=NO test
xcodebuild -scheme WorldWideWebb -configuration Debug \
  -destination 'generic/platform=macOS' -derivedDataPath ~/wwwebb-live/dd-mac \
  CODE_SIGNING_ALLOWED=NO build
```

Package fixtures cover all-on, all-off, fan pending, party, null scene, mood,
red and blue, with neutral labels and no deployment information. Adapter tests
use inline equivalents and controlled suspended requests to test optimistic
state, rollback, ordering, stale refresh rejection, cancellation and polling.
