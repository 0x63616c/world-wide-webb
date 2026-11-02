# Native app shell

The panel starts on the green clock. Swipe up from the bottom to open the
vertically scrolling icon launcher. Each icon opens a full-screen native app;
swiping up from its bottom edge returns to the launcher. There is no pager or
dock. Settings owns wallpaper selection, idle dimming and returning to the clock.

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
and reviewed all app destinations in source. This pass removed the default dusk
background, simplified Lighting, added an accessible Apps action, and replaced
modal dismissal with an upward drag/scale transition. App controls reserve space
for the shared navigation affordances. The physical iPadOS home gesture can still
win at the extreme screen edge; swipe within the panel's lower centre region or
use Apps.

Remaining design findings: Calendar should use aligned agenda rows rather than
repeated glass cards; Music needs a more balanced mixer layout; Weather should
prioritize the forecast over secondary metric cards. Car, Walks, Cameras, Photos
and Settings have usable compositions, with future cleanup focused on secondary
copy and actions. These source reviews are not a claim of visual verification of
every live screen. Private photo and Wi-Fi content was not captured.
