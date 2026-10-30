# World Wide Webb Apple panel: architecture for isolated apps and customizable faces

Status: proposal (Oct 29, 2026). Ticket WWW-8. It covers the native SwiftUI panel (iPadOS 26+ / macOS 26+).
The model is HomeView and watchOS: **faces** made of **complication slots**, filled by **isolated apps**, and the user edits them like an Apple Watch face.
It mirrors the web repo's `app-kit` idea (each `features/<app>/manifest.ts` declares its tiles and its full-screen view) so the two stay conceptually aligned.

## 1. Goals
- **Isolation.** Each feature is its own Swift package target. It compiles and previews on its own and depends only on `PanelKit` (protocols, models) and `PanelUI` (design system). No app imports another app.
- **One contract.** Every app conforms to `PanelApp`. The shell never special-cases a feature.
- **Mock now, real later.** Every app talks to a `…Provider` protocol: a `Mock…Provider` (fixtures, latency) now, and a real provider (the tRPC API / Home Assistant through our backend) later. Views never touch the network.
- **Customizable.** Faces are data (JSON). The layout engine renders any face from any set of installed apps. An edit mode (long-press, like a watch face) lets the user swap faces, move slots and pick which app fills each slot.
- **Real features only.** An app may expose only what our backend supports today. New capability (e.g. Media) is a new module with its own provider, clearly marked as planned.

## 2. Package layout (one SwiftPM workspace under `apps/apple-prototype/`)
```
Packages/
  PanelKit/            protocols, ids, sizes, complication families, Face/Slot models, JSON codec, PresenceState
  PanelUI/             design system: GlassTile, ComplicationSlot, Numerals, VerticalSlider, RingTicks,
                       GlassRoundButton, Wallpaper (licensed photo), Tokens (spacing, radii, type, colours, motion)
  PanelLayout/         layout engine: FaceRenderer, grid solver, pager, zoom-to-full-screen host, edit mode
  Apps/
    LightsApp/         Lamps (Bedroom, Living Room groups; global brightness, scenes, custom colours, party),
                       Lights (Ceiling, Under Cabinet), All
    ClimateApp/        A/C: Cool, Heat, Heat·Cool, Off; 67–77 °F; 2° gap; ambient + action
    FanApp/            A/C fan_mode on↔auto (depends on the Climate *provider protocol* from PanelKit, not on ClimateApp)
    WifiApp/           Guest Wi-Fi: SSID + password, tap to reveal; open / not-configured states. Full screen = big QR hero
                       (CoreImage qrCodeGenerator, WIFI:T:WPA;S:…;P:…;; payload) with name + password below; tile/complications: no QR
    ClockApp/          time, date, greeting, seconds ring; Alarms (label, time, date, tz, snooze, lights);
                       next-alarm ring view (calum_4 style); idle big-numeral face (calum_6 style)
    WeatherApp/        MOCKED: animated Home tile; Weather Now (4 metrics) + Next 12 Hours
    SonosApp/          Sound System: rooms, per-room volume, mute, grouping/join, global + group lock,
                       calibrate/clear, transport (play/pause/next/previous), Now Playing (calum_5 style)
    TeslaApp/          MOCKED (live revival is follow-up): car battery %, range, charging, cabin climate (prior features/tesla, see §7a)
    DogWalkApp/        MOCKED: Walk Zero: shared active walk, history, Live Activity
    CalendarApp/       MOCKED: next-event tile and day timeline
    CamerasApp/        MOCKED: animated licensed demo feeds and camera grid
    PhotosApp/         MOCKED: rotating tile and full-bleed frame
    MediaApp/          MOCKED: browse and play music on Sonos; play video on the panel (AVKit)
  Providers/
    MockProviders/     fixtures for every provider protocol (what the prototype ships with)
    LiveProviders/     later: the tRPC client against apps/api, one provider per app
WorldWideWebb (app target)  composition root: registers apps, picks providers, loads faces JSON
Tests / SnapshotTests       store tests per app; ImageRenderer snapshot tests per tile size / complication / full-screen view
```
Dependency rule: `Apps/* → PanelKit + PanelUI`. `PanelLayout → PanelKit + PanelUI`. Only the app target sees everything.
Shared cross-app state (e.g. Fan reading the A/C mode) goes through provider protocols defined in PanelKit, never through another app's types.

## 3. The `PanelApp` contract (PanelKit)
```swift
public enum TileSize: String, Codable, CaseIterable { case small /*1×1 round*/, medium /*2×1*/, tall /*1×2*/, large /*2×2*/ }

/// watchOS-style complication families, adapted to a wall panel.
public enum ComplicationFamily: String, Codable, CaseIterable {
    case corner        // glyph + short value in a face corner (on the idle Clock face)
    case circular      // round glass, glyph or gauge (e.g. a temperature ring)
    case rectangular   // one-line title + value, or a small chart (e.g. weather, next alarm)
    case inline        // a single text line under the time ("68° · Lamps on")
    case accessory     // the square HomeView tile: icon, bold name, dim room (calum_3 bottom row)
    case hero          // the dominant element of a face (giant Climate numerals, big clock)
}

public struct AppID: Hashable, Codable, RawRepresentable { public let rawValue: String }

@MainActor public protocol PanelApp {
    associatedtype Provider: AnyObject
    associatedtype TileBody: View
    associatedtype ComplicationBody: View
    associatedtype FullScreenBody: View

    static var id: AppID { get }                       // "lights", "climate", "sonos", ...
    static var displayName: String { get }
    static var supportedSizes: Set<TileSize> { get }
    static var supportedFamilies: Set<ComplicationFamily> { get }
    /// Optional per-instance configuration (e.g. which lamp group, which Sonos room). Codable so faces can store it.
    associatedtype Config: Codable & Hashable = EmptyConfig
    static var defaultConfig: Config { get }

    init(provider: Provider)

    func tile(size: TileSize, config: Config) -> TileBody
    func complication(family: ComplicationFamily, config: Config) -> ComplicationBody
    func fullScreen(config: Config, dismiss: @escaping () -> Void) -> FullScreenBody
    /// A cheap primary toggle for the tile glyph (tap glyph = toggle, tap body = zoom). nil = no toggle.
    func primaryAction(config: Config) -> (() -> Void)?
}
```
- **Registry.** `AppRegistry` stores type-erased `AnyPanelApp` values (factories keyed by `AppID`). The layout engine asks the registry for a view by `(appID, slot kind, config)`.
- **Providers.** Each app defines its provider protocol in PanelKit, e.g. `LightsProvider`, `ClimateProvider`, `WifiProvider`, `ClockProvider`, `WeatherProvider`, `SonosProvider`, `MediaProvider`. Each is `@Observable` state plus `async` commands, and reports `pending` per entity for optimistic UI.
- Today's single `HomeDataSource` / `MockHomeDataSource` splits into those protocols. The command enums move per app.

## 4. Shared component library (PanelUI)
- **Tokens:**
  - outer margin 40, gutter 24
  - tile radius = 0.17 × tile side (continuous)
  - glyph = 0.25 × tile height
  - name 0.13 × tile height Semibold
  - subtitle 0.095 × tile height at 60% white
  - hero numerals SF Pro Regular/Medium at about 0.33 × tile height
  - motion: zoom spring (response 0.42, damping 0.86); complication reveal 0.35 s ease-out with scale 0.94 → 1
- **GlassTile:**
  - `.glassEffect` in a `GlassEffectContainer`
  - no painted fills, outlines, specular edges, or custom material imitation
  - regular system glass for text, clear where content visibility permits; semantic warm tint for active controls
  - circular 1×1 controls, ConcentricRectangle/containerShape for larger spans
- **ComplicationSlot(family:):** a frame and clipping per family. Handles placeholder, loading, stale and unavailable states uniformly.
- **Numerals:** a hero number with chevrons; `BigClockNumerals` for the calum_6 face.
- **VerticalSlider:** the Control Center pill; drag, haptics, accessibility adjustable action.
- **RingTicks:** the calum_4 tick ring (progress 0…1, colour).
- **GlassRoundButton**, **PageDots**, **FullScreenChrome:** × top-left, title, time top-right, saturated background.
- **Wallpaper:** licensed downsampled photographic content for glass faces (see sources.md); original green Clock artwork. Chosen per face.

## 4a. Live, characterful tiles (animation contract)
Tiles may declare live animation, like Apple's Clock and Weather widgets. The contract in PanelKit:
```swift
public enum LiveAnimation: Codable, Hashable { case none, ambient /*slow idle motion*/, realtime /*per-second clock*/ }
public protocol PanelApp { /* … */ static var liveAnimation: LiveAnimation { get }   // default .none
    func animationIntensity(for state: AppState) -> Double }                           // 0 when off/idle
```
The engine:
- wraps live slots in `TimelineView(.animation(minimumInterval:))` (realtime = 1/60 for the sweep, ambient = 1/30)
- pauses everything when the slot is offscreen, the face is idle/dimmed, Low Power, or `accessibilityReduceMotion` (static fallback frame)
- caps concurrently animating slots per face (e.g. 4) for battery/thermal

Per app (subtle and Apple-like; motion tied to real state only):
- **Clock:** a smooth sweeping second hand (TimelineView), numerals in `.contentTransition(.numericText())`.
- **Weather:** a condition-driven background with MeshGradient sky by condition and time of day, drifting clouds, rain streaks, sun glow (Canvas particles), as in Apple Weather.
- **Fan:** the glyph spins (`symbolEffect(.rotate)`) only when fan_mode = on.
- **Lamps:** when on, a warm radial glow breathes very slowly (PhaseAnimator), its intensity mapped to brightness.
- **Sonos:** subtle EQ bars (`symbolEffect(.variableColor)` / custom bars) only when transportState = PLAYING, plus an artwork-colour tint on the tile.
- **Tesla:** the charging bolt and ring pulse (KeyframeAnimator) only while chargingState = charging.
- **Climate:** a gentle cool/heat hue shift while the A/C is actively cooling/heating.

## 5. Layout engine and faces (PanelLayout)
A face is pure data, saved as JSON (Application Support, later synced per device through the existing device-settings API):
```json
{
  "version": 1,
  "faces": [
    { "id": "home", "style": "modular", "wallpaper": "teal-geometric",
      "grid": { "cols": 3, "rows": 3 },
      "slots": [
        { "app": "climate", "kind": "tile", "size": "large", "at": [0,0] },
        { "app": "clock",   "kind": "complication", "family": "hero", "at": [2,0] },
        { "app": "wifi",    "kind": "tile", "size": "small", "at": [2,1] },
        { "app": "lights",  "kind": "tile", "size": "small", "at": [0,2], "config": { "target": "lamps.bedroom" } },
        { "app": "lights",  "kind": "tile", "size": "small", "at": [1,2], "config": { "target": "lamps.living_room" } },
        { "app": "lights",  "kind": "tile", "size": "small", "at": [2,2], "config": { "target": "lights.ceiling" } }
      ] },
    { "id": "controls", "style": "modular", "wallpaper": "teal-geometric", "grid": { "cols": 3, "rows": 1 },
      "slots": [
        { "app": "lights", "kind": "tile", "size": "small", "at": [0,0], "config": { "target": "lights.under_cabinet" } },
        { "app": "fan",    "kind": "tile", "size": "small", "at": [1,0] },
        { "app": "lights", "kind": "tile", "size": "small", "at": [2,0], "config": { "target": "all" } } ] },
    { "id": "clock", "style": "bigNumerals", "background": "#2FA84F", "idleDefault": true,
      "nearComplications": [
        { "app": "climate", "family": "corner" }, { "app": "lights", "family": "corner", "config": { "target": "lamps" } },
        { "app": "wifi", "family": "corner" }, { "app": "weather", "family": "corner" } ] },
    { "id": "music", "style": "fullBleed", "app": "sonos", "view": "nowPlaying" },
    { "id": "weather", "style": "fullBleed", "app": "weather", "view": "face" }
  ]
}
```
- **Styles** are the face templates, like watch faces:
  - `modular`: a grid of tiles and complications (calum_3)
  - `bigNumerals`: hero clock plus corner complications (calum_6)
  - `fullBleed`: one app's face view (music, weather, alarm ring)
  - `infograph`: a hero plus a circular and rectangular ring (later)
  Each style declares which slot kinds, families and sizes it accepts. The engine validates JSON against the style and against each app's `supportedSizes` / `supportedFamilies`. Invalid slots fall back to an empty slot, never a crash.
- **Grid solver:** supports 1×1 round, 2×1 wide, 1×2 tall and 2×2 hero spans. Cell side rounds down to an 8-point multiple; one 24-point gutter on iPad. Origins and extents derive only from spans and gutter; reject overlap/out-of-bounds layouts. Current Home is 5×3: Climate at (0,0) 2×2, Lamps at (2,0) 1×2, Weather at (3,0) 2×1, Car at (3,1) 2×1, Calendar at (0,2) 2×1, Music at (2,2) 2×1 and Fan at (4,2). Home · More holds the remaining modules and five round controls, including Walk Zero per §5b below. Mac remains fixed 1376×1032. Phone owns a scrolling two-column composition with 16-point gutters, wide Climate/Music/Car, tall Lamps paired with circular controls, and a reserved bottom safe-area pager. The JSON above documents the earlier proposal; these spans supersede it for iteration 4.
- **Verified geometry (4b):** `HomeFaceLayout` is the single source of frames for both live Home faces. At 1376×1032, 224-point cells and 24-point gutters yield five disjoint 224-point circles, 472-point two-cell spans, and 80-point top/side/bottom margins before an 80-point pager band. Phone uses 16-point gutters and a 24-point content margin above its separate 80-point pager band; hardware safe areas are excluded before solving. `HomeFaceLayoutTests` checks every pair for intersections, nearest horizontal/vertical neighbours for equal gutters (±0.5 pt), circular aspect ratios, panel grid alignment and phone scroll-end containment at four widths.
- **Pager:** horizontal paging between faces with page dots. Idle: after N minutes, return to the `idleDefault` face.
- **Presence:**
  - `PresenceState` (`far`/`near`) lives in PanelKit.
  - Prototype: a tap, plus the `-presence near|far` launch arg.
  - Later: the panel's existing wake/motion signal, or camera proximity.
  - Faces with `nearComplications` reveal them on `near`.
- **Zoom host:** native matchedTransitionSource/navigationTransition(.zoom), with stable glassEffectID identities in the face namespace; any slot zooms to its app's `fullScreen`. Dismiss with × or a swipe down.
- **Edit mode (later):** long-press a face to get a jiggle/scale-down carousel of faces. Tap "Edit" to show slot outlines. Tap a slot to get an app picker filtered by compatible size or family, plus a config picker (e.g. which lamp group or Sonos room). Then save the JSON. Add a face from the style gallery, delete a face, reorder faces.

## 6. Sonos: current controls and prototype playback-position extension
Backed by features/sound/api.ts:
- **Per-room state:** name, volume (with the baseline/calibration mapping), muted, transportState, sourceLabel/sourceKind (spotify, airplay, tv, line-in, idle), trackTitle, trackArtist, albumArtUri, group (coordinator/members), availability.
- **Commands:**
  - `sonosSetVolume` (desired-state, enforced by the 1 s worker), mute
  - transport play / pause / next / previous on the coordinator
  - join (group under a leader), everything to the Desk, everything to the TV
  - calibrate / clear, global and group lock
- **Views:**
  - **Tile:** a medium/large mixer with readable faders.
  - **Complication:** rectangular (title, artist, room) or circular (volume).
  - **Full screen, Mixer:** big per-room faders, mute, grouping chips.
  - **Full screen, Now Playing** (calum_5 style):
    - background tinted from the album art
    - artwork card, big title/artist and source
    - glass round × and a room/group picker
    - transport buttons
    - thin capsule time scrubber below metadata, elapsed / negative remaining in monospaced digits; expands during touch
    - separate volume slider below transport, with speaker glyph endpoints
- **Prototype-only extension:** `SoundRoom` exposes `positionSeconds`, `durationSeconds`, `positionUpdatedAt` (fixture 1:47 of 3:52); `HomeCommand.seek(roomID, seconds)` enters the provider through `HomeDataSource.send`. TimelineView derives elapsed position while playing. Pause anchors elapsed time, seek clamps bounds and synchronizes the coordinator group, and joins copy the leader's timestamp/position.
- **Production follow-up required:** current backend response/schema lacks position/duration/timestamp and a seek mutation. Add them from UPnP AVTransport GetPositionInfo or HA `media_position`, `media_duration`, `media_position_updated_at`, plus seek transport. Do not imply the prototype scrubber is connected to production. This supersedes the earlier no-scrubber rule.
- Mocked in the prototype: one fixture track with generated placeholder artwork.

## 7. Media module (fixture prototype; live backend remains a follow-up)
Purpose: actually choose and start things to play, not just control what's already playing.
- **Music on Sonos:**
  - Browse Sonos favourites, playlists and recent items, then pick a room or group, then play.
  - Backend needed: new tRPC procedures wrapping Home Assistant `media_player.browse_media` and `media_player.play_media` (plus `media_player.join` for target groups). These don't exist yet, so this needs a ticket for the API and a `MediaProvider` live implementation.
- **Video on the panel:**
  - Play video locally with AVKit (`VideoPlayer` / `AVPlayerViewController`).
  - Sources to decide: e.g. a self-hosted library or URLs served by our API, or AirPlay *to* the panel later.
  - Full-screen player with glass controls; optional "send audio to Sonos" through the TV/line-in grouping that already exists.
- **Contract:**
  - `MediaProvider`: `browse(path) async -> [MediaItem]`, `play(item, on: SonosTarget)`, `localPlayback(item) -> AVPlayerItem`.
  - `MediaApp` supports a `large` tile (recents grid), a `rectangular` complication ("Continue: …") and a full-screen browser.
  - Now Playing stays in SonosApp. MediaApp hands off to it after `play`.
- **Prototype scope:** browsable original fixture albums/playlists dispatch play to the selected Sonos room and coordinator group. A bundled, silent 12-second licensed landscape study plays in an AVKit sheet. This is functional in-memory playback state; no production integration or audio recording is implied.


## 7a. Tesla module (TeslaApp): revival of the deleted `features/tesla`
**Prior code found:** `features/tesla/` existed until "The Simplification" (9d7c6c23, #748, Sep 19, 2026), which deleted it along with `maplibre-gl` / `apps/web/src/lib/maps/` (ADR-0013). Last full version: `git show 9d7c6c23^:features/tesla/{api,service,manifest,web,places,tesla-map}.ts(x)`.
- Earlier history: tile fold into features/tesla (4c4cd22c); asleep state (c04e3e89); Offline state with last-seen (b57bfeb5, #148); full-page detail (b5cbd866); real Fleet entity ids (e8f23631, #307).
- Today only the Tesla climate-entity exclusion in `features/ac/service.ts` remains (`TESLA_ENTITY_PREFIX`).

**Data shape (reuse verbatim, from the old `teslaOutputSchema`):**
```swift
public struct TeslaState: Codable, Equatable {
    var name: String; var nick: String
    var place: String; var lat: Double?; var lon: Double?   // the panel shows `place` only; no coordinates in fixtures
    var charging: Bool; var chargingState: ChargeState       // starting|charging|stopped|complete|disconnected|no_power
    var preconditioning: Bool
    var rate: Double        // charge rate
    var pct: Int            // battery %
    var range: Double       // miles
    var odo: String
    var climate: Double     // cabin °F
    var availability: Availability  // online | asleep(since) | offline(lastSeen); the old tile had Asleep/Offline layouts
}
```
- **HA entities (Tesla Fleet integration, prefix = `TESLA_ENTITY_PREFIX`):**
  - sensor: `_battery_level`, `_charging`, `_charge_rate`, `_battery_range`, `_odometer`, `_inside_temperature`
  - `device_tracker._location`, `climate._climate`, `switch._charge`
- **Commands (old tRPC):** `tesla.setCharging(on)`, `tesla.setPreconditioning(on)`. Dead HA states (unavailable/unknown/none) map to asleep/unavailable.

**PanelApp surface:**
- **Tile** (small/medium):
  - battery % hero with a battery glyph
  - range in miles
  - charging status ("Charging · 11 kW" / "Complete" / "Unplugged")
  - Asleep / Offline pill
- **Complications:** circular = charge-% ring; corner/inline = "78%"; rectangular = % + range + charging.
- **Full screen:**
  - big battery gauge with charge status, rate and the start/stop charge toggle
  - cabin climate: cabin temperature plus a precondition on/off toggle
  - place ("Home") and odometer
  - no map: the map was deleted with maplibre, so it's not revived in the prototype
- **Backend:** reviving needs `features/tesla` (api + service) restored from 9d7c6c23^ (a ticket). The prototype uses `MockTeslaProvider` only.

## 8. Migration from the current prototype (apps/apple-prototype/Sources, about 1.7k lines, single target)
Cheap steps, in order. Each is a mechanical move with tests staying green:
1. Extract `Design.swift` into **PanelUI** (tokens, GlassTile, buttons, wallpaper, slider, ring).
2. Split `HomeDataSource` into per-app provider protocols in **PanelKit**; `MockHomeDataSource` becomes `MockProviders` (one class can still back several protocols).
3. Move each feature view file (`LampsView`, `Controllers`, `ClockViews`, `WeatherViews`, `SoundViews`) into its `Apps/*` package behind a `PanelApp` conformance.
4. Replace the hard-coded `HomeView` grid with **PanelLayout**'s `FaceRenderer` and a bundled `faces.json` (the v2 layout above).
5. Snapshot tests per app (tile sizes, families, full screen) in each package. These also give the fast design render loop (no app launch).
6. Later: edit mode, LiveProviders (tRPC), presence from the real wake signal, MediaApp.

**Decision for now:** don't restructure during design iteration. Visuals change daily, and moving files mid-iteration would slow the fast render loop. Do steps 1–5 as follow-up ticket(s) once Calum approves the v2 design (suggested: WWW-8 follow-up "apple-prototype: split into PanelKit/PanelUI/PanelLayout + per-app packages", label model:astra, area:ui). Step 7 (Media) needs its own backend ticket.

## 9. Open questions
- Should faces JSON sync per panel through the existing device-settings API, or stay local?
- What is the presence source on real hardware (existing wake capture vs proximity)?
- Where does video come from for MediaApp?
- Track position and seek are now required; schedule the backend fields/mutation follow-up described in §6.

## Pass 5 modules and implemented face data

The source remains in one prototype target per §8; names above describe logical Apps, each behind its provider seam. CalendarProvider, CamerasProvider, PhotosProvider and MediaProvider ship with mock implementations; WeatherState and Sonos commands reuse HomeDataSource. No access-control module, fixture, entity or vehicle access command is included. Sonos global/group volume lock remains a volume setting.

Home and Home · More both use the same five-column/three-row HomeFaceLayout solver. Home: Climate (0,0) 2×2, Lamps (2,0) 1×2, Weather (3,0) 2×1, Tesla (3,1) 2×1, Calendar (0,2) 2×1, Now Playing (2,2) 2×1, Fan (4,2) circle. More: Cameras (0,0) 2×2, Photos (2,0) 2×1, Media (2,1) 2×1, Sonos Rooms (4,0) 1×2; Clock/Ceiling/Cabinet/Wi-Fi/All lights form five bottom circles. Both have 24-pt gutters and equal 80-pt outer margins on the target panel. Phone uses separate two-column scroll compositions with 16-pt gutters and 24-pt bottom clearance. Geometry tests exercise both faces at every phone width, including scroll ends.

Weather combines four current metrics and 12 hourly entries. Calendar uses generic public-place events; Media has no real recordings. Camera previews use licensed landscapes with LIVE, Demo feed and simulated-camera labels; they are never represented as real property cameras. Photos cycles three licensed images every 12 seconds with a 1.2-second crossfade, paused under Reduce Motion. The photo frame has a small clock/date; all media stays bundled and works offline.

## Pass 5b: DogWalkApp and shared walk state

DogWalkApp adds a wide Walk Zero tile on Home · More, a full-screen history with weekly total, per-walk average, streak and 7/30-day Swift Charts, and a reserved lower-left Clock complication. The tile starts/stops a walk inline and its title opens the history. Idle reads “Last walk 3h ago · 32 min”. Cameras now occupies (0,0) 2×1 and Walk Zero (0,1) 2×1; the remaining spans and all five round controls are unchanged. Every module is reachable on both panel and phone Home pages, verified by the layout tests.

`WalkProvider` exposes `activeWalk`, `history`, `start(at:)` and `stop(at:)`. A walk has `{id, startedAt, startedBy device, endedAt?}`. Elapsed time is derived from `startedAt` in TimelineView; there is no local counter. `MockWalkBackend` owns one active record and a 3-week fixture log; multiple device providers share that backend. Starting twice is idempotent. Stopping from either client ends the shared record and appends history once. `-walkStartedRemotely` injects an iPhone start 12:04 earlier; `-walkRunning` starts locally. The mocks model server synchronization in memory, and do not connect the two separately launched simulator processes over a real network.

**Production follow-up:** persist the walk log and active walk in the backend (new table with stable ID, dog ID, startedAt, startedBy device and endedAt; enforce one active walk transactionally). Add tRPC start/stop/active/history procedures, with idempotent commands and a subscription or polling for cross-device updates. The backend owns timestamps and completion. Retain ActivityKit push-to-update tokens per device/walk so stopping on iPad also ends the iPhone Live Activity. Reconcile the current active record when either app launches or reconnects; never reset the start time locally.

The iOS app embeds `WalkActivityExtension` via project.yml. Lock Screen, compact/minimal and expanded Dynamic Island content use the shared startedAt and deep-link to history. Local observation synchronizes ActivityKit when the active record changes. The simulator preview is explicitly labelled and is not represented as a SpringBoard capture. Backend persistence, cross-device networking and push tokens remain follow-ups, matching the Sonos seek limitation in §6.

Validation: DogWalkProviderTests covers elapsed time, negative-clock clamping, remote start/stop, two clients sharing one active record, idempotent completion, fixture history and chart summaries. HomeFaceLayoutTests covers both faces, every module's reachability, safe margins, equal gutters and no overlapping frames on iPad and iPhone.

### Pass 6 phone and instrument layout

Phone Home keeps its 80-point reserved pager band but the visible glass capsule is 56 points. A 16-point bottom fade applies to scrolling content only; the shared photographic wallpaper remains continuous behind the face and pager. Compact cards use 36-point concentric corners. The same HomeFaceLayout frames and safe-margin/gutter tests still drive both Home pages.

Walk Zero exposes a visible History affordance separately from its 72-point circular Start/End action. The full-screen active state labels its 64-point elapsed value and places the origin device on a separate line. The provider and backend ownership described in §5b are unchanged.

`verify-schemes.sh` generates the project and builds all five explicit schemes. It runs every available test action, with the simulator phase under www8-simlock and isolated Panel/Panel-Smoke build products (a smoke build otherwise strips the unit-test plugin). The macOS application scheme has no test action.

Pass 6b: DogWalkPage holds the status region at 144 points across shared-walk states and uses matched-height chart/history reading surfaces. The complete history remains available in its own scroll on iPad and the page scroll on iPhone. Compact Home span heights are 240-point Climate and 160-point Weather; the same solver/reachability/gutter tests remain authoritative.

Iteration 7 composition: the shared solver retains 1×1, 2×1, 1×2 and 2×2 spans. A 1×1 information module (Weather/Calendar) is rectangular; 1×1 accessory toggles are circles. Home and More may expose the same shortcut, with per-face stable identity and shared provider state; geometry/reachability tests enforce uniqueness within each face. Phone pairs information modules, retaining its independent scroll layout. Clock has a separate dial geometry and full-sweep glyph clearance test.

Pass 7b: phone solver restores full-width Weather/Calendar rows after median rejection of the paired candidate. Panel mixed spans and duplicate-source identity remain as designed in pass 7. No provider schema or native hybrid behavior changes.
