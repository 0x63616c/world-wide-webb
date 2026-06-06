/**
 * CC guard: a tile's registry `label` MUST equal the title it renders in its
 * TileHeader on the board. The minimap hover label, the centered-tile pan label,
 * and the "Open …" aria-label all derive from `label`, so any drift makes the
 * minimap name a tile something other than what the user reads on it (the exact
 * bug this guards against — "Weather" vs "Weather Now", "Events" vs "Upcoming").
 *
 * Each board tile hard-codes its title as a `title="…"` literal in its view's
 * TileHeader, so we read the view source at build time and assert that literal
 * matches the registry label. A source check (vs rendering) needs no per-tile
 * prop wrangling and pins the exact string. Clock is the sole exception: it's a
 * greeting tile with no static header title.
 */
import { describe, expect, it, vi } from "vitest";

// MapLibre (via TeslaTileView, imported transitively by tile-registry) calls
// window.URL.createObjectURL at import time — unavailable in jsdom.
vi.mock("maplibre-gl", () => ({ default: {} }));
vi.mock("pmtiles", () => ({ Protocol: vi.fn().mockImplementation(() => ({ tile: vi.fn() })) }));
vi.mock("@protomaps/basemaps", () => ({
  layers: vi.fn().mockReturnValue([]),
  namedFlavor: vi.fn().mockReturnValue({}),
}));

import { TILE_REGISTRY } from "../../../lib/tile-registry";

// Clock renders a live greeting, not a static TileHeader title; its registry
// label ("Clock") is purely a name, so it has no `title="…"` literal to match.
const NO_STATIC_TITLE = new Set(["tile_clock"]);

// View source, keyed by bare filename (e.g. "WeatherNowView.tsx"). Eager + raw
// so the assertions are pure string checks with no rendering.
const viewSource = import.meta.glob("../*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("tile registry — label matches rendered title", () => {
  for (const entry of TILE_REGISTRY) {
    if (NO_STATIC_TITLE.has(entry.id)) continue;
    it(`${entry.id}: view renders title="${entry.label}" matching its registry label`, () => {
      const file = `../${entry.viewComponent.name}.tsx`;
      const src = viewSource[file];
      expect(src, `${entry.id}: could not read source for ${file}`).toBeDefined();
      expect(
        src.includes(`title="${entry.label}"`),
        `${entry.id}: ${entry.viewComponent.name} must render title="${entry.label}" so the minimap label maps to the tile's title`,
      ).toBe(true);
    });
  }
});
