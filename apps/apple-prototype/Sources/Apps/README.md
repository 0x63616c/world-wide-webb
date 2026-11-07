# Native app shell

Tap the clock to slide Home up over it. Tap Close or choose Clock to slide Home
back down. Swipe left or right on the clock to cycle Green, Midnight, Paper and
Ember. The panel remembers the selected face.

Swipe Pop is the spring transition for app opens and clock-face swipes. The dial
follows your finger and shrinks as the adjacent face enters. Release to settle
on the next face, or let a short drag spring back.
When an app opens, the clock, glass and app selectors slide left and shrink
together as the app enters from the right. Back reverses the motion and restores
the launcher's scroll position.

App pages use a plain close button at the top right to return to the launcher, including
Settings, protected pages, unavailable states and Classic. App scroll views only
bounce when their content overflows. A single-finger content scroll never closes
an app. Back buttons are the app navigation; accessibility escape remains available.
Settings uses a native split view for Display and Security preferences.
Back chrome has no painted full-width background: app backgrounds extend behind
the transparent top safe-area inset while content remains below the button.
Settings, Timer and Climate float the close button above their content.

The first launcher row is Calendar, Weather, Lights, Climate and Dog Walker.
Photos, Tesla and Wi-Fi lead the next row. Settings is last. Display order and
stable IDs live in `PanelAppCatalog`, shared by the native and design hosts.

## App artwork

All 14 apps use custom vector artwork in `Icons/`, extending the approved
Weather, Lights, Music and Photos designs across the complete home screen.
Backgrounds run from light at the top to darker at the bottom; foreground shapes
retain flat faces and separate depth layers. Artwork occupies approximately
62–66% of the tile along its dominant axis, with optical adjustments for the
cloud, vehicle and stacked cards. The bulb is reduced to match that visual inset.
`PanelAppIcon` is the shared entry point for the launcher and notification
surfaces. Calendar retains its live weekday and date on two layered pages.
The launcher renders tiles 10% smaller inside the existing grid slots (100.8 pt
in the 112 pt panel slot; 68.4 pt in the 76 pt compact slot), retaining the label
positions and button hit areas. Notification artwork keeps its own requested size.

`LauncherAppIcon` adds a restrained pointer tilt and foreground parallax on the
existing button press. It introduces no touch gesture or device-motion sensor.
Notification icons are always static.
These are in-app launcher illustrations, not the operating system's app-bundle
icon: they render as SwiftUI shapes at the requested size, with no bitmap upscale
or simulated glass layer. The launcher surface continues to use native Liquid
Glass. Home comparison captures live in `docs/screenshots/layered-home-icons/`.

## Photo Booth

Photo Booth prefers the front camera. Photo takes one shot; Strip takes four,
with a three-second posing countdown between shots. The self-timer offers Off,
1, 3, 5 and 10 seconds before the first shot (3 seconds by default). The shutter
becomes Cancel during capture, and leaving/backgrounding cancels partial strips
without uploading them. Four completed frames become one white-bordered JPEG
strip, readable in both native and web galleries. A finished strip stays in the
preview until the next capture or navigation. A shot saves to the existing booth
gallery; the gallery button opens earlier booth photos and every frame of older
burst/strip captures. Wake photos are
excluded. Back moves from an enlarged photo to the gallery, then to the camera,
then Home. The existing booth manifest is private, so each opening requires a
fresh synced PIN and backgrounding locks the page.

Capture/configuration runs on a serial actor, with a real AVFoundation preview
and rotation coordinator. Leaving the camera stops it. Saving belongs to the
app's data source, so a failed JPEG remains available for retry after navigation
while the app stays open; explicit discard requires the unlocked page. Uploads
use the existing same-origin booth endpoint and bounded JPEG contract. Capture
of single photos has been confirmed on Calum's panel; physical strip capture and
rotation remain unverified. Without a camera the simulator shows its unavailable
state. The explicit DEBUG-only `-hybridBoothCamera` fixture supplies numbered,
clearly labelled simulator test images to exercise capture, composition, upload
and gallery display without private photos or a fabricated live camera feed.

## Timer

The Timer app uses a wide black face, equal-length orange perimeter ticks and a
large countdown. The border begins turning several ticks before each corner. It shares the alarm's arc-length sampler, so spacing stays even through turns.
The timer uses a 12-point edge inset and 32-point positioning corners, concentric
with the shell's 44-point surface. Tick direction has a separate 100-point turning
radius: marks start tilting while their anchors are still flush with a straight
edge. An exact diagonal tick anchors every corner, with equally spaced neighbors
on either side; straight-edge spacing absorbs the small remainder so the corner
fans remain symmetric. Its ring updates at display cadence, fading the fractional last tick even
for short durations.
Tap the orange duration beneath the countdown to choose hours, minutes or seconds.
Presets live inside that editor. Start, Pause, Resume, Reset and Again operate on
the real local timer; the fixed Back button returns to Home.

The shell persists the timer deadline across navigation, suspension and relaunch.
Pause preserves the exact remaining interval. The active timer holds the panel
awake and plays ticks and a completion sound.
An OS local notification supplies the completion alert outside the page, subject
to notification/sound permissions; denied or silent settings are shown honestly.
VoiceOver reads a duration and announces completion once. Simulator recordings
disable only OS notification prompts/sounds, and show the countdown at normal speed.

## Panel PIN

Photos and Tesla command confirmation use the shared `PanelPINEntry`: six masked
dots, a native glass number pad, delete and automatic six-digit submission. Digits
stay in memory and clear when leaving the page or backgrounding the app. Photos
still asks for a fresh PIN on every opening. The default visual “Enter PIN”
subtitle is omitted; VoiceOver still announces it and multi-step flows keep
their specific instructions. Tesla keeps command execution in its
provider so keypad dismissal cannot cancel the reported-state refresh.

Settings → Security → Change PIN verifies the current synced PIN, asks for a new
six-digit PIN and confirmation, then updates only `pinCode` through the existing
settings API. Confirmation can restart new-PIN entry; recovery is disabled while
saving. Wrong PIN, mismatch and connection errors remain in the flow. This retains
the existing client-side soft-lock policy (ADR-0004), not a new authentication system.

## Clock motion review

The clock has date at the upper left and digital time at the lower right,
using the same day/night ink. `ClockLauncherMotion` owns the transition separately
from app navigation. Reveal shrinks the clock slightly as it slides left; the launcher enters from
the right and expands into place with a small spring. Swiping right on the
launcher drives the same transition in reverse;
Depth and Dissolve are comparison candidates selected only through debug launch
argument `-launcherTransition swipePop|depth|dissolve`.
Real simulator clips live in `docs/screenshots/panel-pin-navigation/`. The capture
suite records the left swipe and reverse right swipe for each candidate.

## Adding an app

1. Add a stable case to `PanelAppFeature` in PanelKit's `PanelAppCatalog.swift`.
2. Register a `PanelAppDefinition` in `PanelAppCatalog.standard`: stable ID,
   short display name, SF Symbol, accent and typed route. Array order is launch order.
3. Map the feature to its native destination in `HomeView` / `PanelHomePresentation`.
   Exhaustive switches make a missing implementation a compile error. Keep feature
   UI and providers in their own files; never put network work in the catalog.
4. Preserve the feature's access gate in its destination. The launcher does not
   grant access or replace photo/PIN permission checks.

The launcher, scrolling, navigation state, Back control and accessibility
are shared. Adding an app does not require changing their layout or gesture code.
`PanelAppCatalogTests` checks unique identity, feature coverage, capability filtering
and shell transitions. The live host supplies its existing providers; the Mac
prototype uses its existing preview providers through the same shell.

Classic is an explicit host capability and the only route that opens the web
board. It is absent in hosts without that capability. Unavailable native features
remain native unavailable screens rather than silently opening Classic.

## Design review — 2 November 2026

A separate Astra reviewer inspected the real Lighting and launcher screenshots
and reviewed all app destinations in source. The current pass keeps opacity-only app dismissal, with no floating Apps button.
Use the fixed Back button from app pages, or Escape in the simulator.

Remaining design findings: Calendar should use aligned agenda rows rather than
repeated glass cards; Music needs a more balanced mixer layout; Tesla, Walks, Cameras, Photos
and Settings have usable compositions, with future cleanup focused on secondary
copy and actions. These source reviews are not a claim of visual verification of
every live screen. Private photo and Wi-Fi content was not captured.

## Weather and night appearance

Weather uses a full-screen condition-driven SwiftUI atmosphere (day/night, clouds,
overcast, rain, snow and fog), paused in inactive scenes. The
comparison gallery has been removed from the live app. Forecast and metrics use
one aligned region. Wi-Fi keeps the reveal target and text slot at fixed layout
positions; the QR caption is “scan to connect.”

The clock uses the weather provider's absolute sunrise, sunset and next-sunrise
values. At sunset its green background becomes black, numerals become silver and
hands stay brighter. At sunrise it returns to green. Missing solar data can use
the reported moon symbol and local hour; while weather loads, the local hour selects
the initial palette. Stale solar schedules do not extrapolate new sunset
times. The debug launch argument `-previewNightClock` previews only the night
palette without changing the system clock or stored user settings.

## Activity and navigation

The Display settings slider controls the return-to-clock delay, which defaults to
60 seconds. Screen dimming has a separate deadline. An active timer or dog walk
suspends both deadlines. A tap wakes the dimmed panel. On the native iPad kiosk,
that wake triggers a short front-camera burst, with camera permission, and
uploads the frames as one Activity session. A window observer tracks interaction
without forwarding the wake tap into app controls.
VoiceOver escape and the named Open apps action provide equivalent navigation.

The chooser includes ten procedural animated art styles. Its previews are frozen,
launcher animation pauses beneath an open app.
Local simulator builds remember an explicitly supplied localhost server address,
so icon relaunches do not silently switch to production. Authentication browsers
use a full-screen system Safari controller.

Simulator builds also accept Escape to open the app grid (enable Device Hub's
Capture Keyboard and focus the simulated display). This adds no on-screen chrome.
The launcher greets Calum by time of day. Climate mode choices are Heat, Cool and Off; an existing Heat·Cool state remains visible until changed. The top-right photo picker stores a circular avatar on the device. The car destination retains its stable `car` route ID.

## PIN/navigation review — 3 November 2026

A separate Astra reviewer inspected the actual keypad screenshot, updated source,
and movie samples every 0.2 seconds. Reveal remains the default: its opaque clock
edge keeps the launcher readable; Depth and Dissolve briefly superimpose numerals
over app labels. Clock time/date placement and launcher names fit. This review
does not establish physical touch feel or frame-rate performance.

Validation on local Xcode 27: 12 PanelKit API/catalog tests; 14 live-provider tests
including command lifetime after keypad dismissal; nine HomeView launch/access
UI tests; three recorded motion comparisons. Typecheck passed. The new access
tests extend the existing HomeViewLaunchTests smoke suite, adding no CI job.

Lights brightness and white temperature use `FilledLevelControl`, shared with
Music volume: a filled draggable bar with local drag preview, one commit on
release, bounded values, and adjustable accessibility actions. Cameras is no
longer registered in the native app catalog. Notification banners sit 20 points
from the top-right edges, and the entire notification history uses dark mode;
Classic reconnects against a black native background.

Lights and Calendar omit redundant page titles. The clock places its date at
the top left and digital time at the bottom right. White temperature previews
the current drag value in Kelvin and an approximate warm-to-daylight screen
colour, while committing the lamp change only when the drag ends.
