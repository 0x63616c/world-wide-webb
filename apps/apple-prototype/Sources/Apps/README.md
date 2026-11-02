# Native app shell

The panel starts on the green clock. Swipe up from the bottom to open the
vertically scrolling icon launcher. Each icon opens a full-screen native app;
swiping up from its bottom edge returns to the launcher. There is no pager, dock or floating Apps button. Apps close with a short fade.
Settings uses a native split view for Display, Clock and Apps preferences.

## Adding an app

1. Add a stable case to `PanelAppFeature` in PanelKit's `PanelAppCatalog.swift`.
2. Register a `PanelAppDefinition` in `PanelAppCatalog.standard`: stable ID,
   short display name, SF Symbol, accent and typed route. Array order is launch order.
3. Map the feature to its native destination in `HomeView` / `PanelHomePresentation`.
   Exhaustive switches make a missing implementation a compile error. Keep feature
   UI and providers in their own files; never put network work in the catalog.
4. Preserve the feature's access gate in its destination. The launcher does not
   grant access or replace photo/PIN permission checks.

The launcher, scrolling, navigation state, bottom-edge gesture and accessibility
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
The physical iPadOS gesture can still win at the extreme edge; use the lower
content band or Escape in the simulator. Five-finger pinch remains available
on the panel, with device verification required under Guided Access.

Remaining design findings: Calendar should use aligned agenda rows rather than
repeated glass cards; Music needs a more balanced mixer layout; Tesla, Walks, Cameras, Photos
and Settings have usable compositions, with future cleanup focused on secondary
copy and actions. These source reviews are not a claim of visual verification of
every live screen. Private photo and Wi-Fi content was not captured.

## Weather and night appearance

Weather uses a full-screen condition-driven SwiftUI atmosphere (day/night, clouds,
overcast, rain, snow and fog), paused for Reduce Motion and inactive scenes. The
comparison gallery has been removed from the live app. Forecast and metrics use
one aligned region. Wi-Fi keeps the reveal target and text slot at fixed layout
positions; the QR caption is “scan to connect.”

The clock uses the weather provider's absolute sunrise, sunset and next-sunrise
values. At sunset its green background becomes black, numerals become silver and
hands stay brighter. At sunrise it returns to green. Missing solar data can use
the reported moon symbol; stale solar schedules do not extrapolate new sunset
times. The debug launch argument `-previewNightClock` previews only the night
palette without changing the system clock or stored user settings.

## Activity and navigation

Sixty seconds without interaction returns to the clock. The Display preference
controls whether that clock is also dimmed. Touching a dimmed clock wakes it;
swiping up from the lower edge opens the launcher. A window-level observer tracks
taps and drags without an invisible view covering app controls. Five-finger inward
pinches return to the launcher anywhere on screen; two-finger zoom is untouched.
VoiceOver escape and the named Open apps action provide equivalent navigation.

The chooser includes ten procedural animated art styles. Its previews are frozen,
launcher animation pauses beneath an open app, and Reduce Motion freezes all art.
Local simulator builds remember an explicitly supplied localhost server address,
so icon relaunches do not silently switch to production. Authentication browsers
use a full-screen system Safari controller.

Simulator builds also accept Escape to open the app grid (enable Device Hub's
Capture Keyboard and focus the simulated display). This adds no on-screen chrome.
Settings keeps its sidebar visible. Its Apps section is catalog-driven and stores
options under each stable app ID through PanelAppPreferences: motion reduction
and idle return duration are applied by the shared app host. New destinations
inherit these settings automatically. The default idle duration remains 60 seconds.
The launcher includes the current local date and time; the car destination is
labelled Tesla while retaining its stable `car` route ID.
