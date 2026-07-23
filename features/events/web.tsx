// Barrel for the events feature's two tile faces. Each of the 4 tile symbols
// is re-exported from its OWN file — EventsTile.tsx exports only EventsTile
// (imports EventsTileView from its own file); ClockGreeting.tsx exports only
// ClockGreeting (imports ClockGreetingView from its own file). Both
// EventsTileView and ClockGreetingView keep their function names + filenames
// for the tile-title-sync guard's viewComponent.name lookup.

export { ClockGreeting as ClockTile } from "./web/ClockGreeting";
export { ClockGreetingView as ClockTileView } from "./web/ClockGreetingView";
export { EventsTile } from "./web/EventsTile";
export { EventsTileView } from "./web/EventsTileView";
