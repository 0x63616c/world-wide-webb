/**
 * CC guard: a tile's registry `label` MUST equal the title it renders in its
 * TileHeader on the board. The minimap hover label, the centered-tile pan label,
 * and the "Open …" aria-label all derive from `label`, so any drift makes the
 * minimap name a tile something other than what the user reads on it (the exact
 * bug this guards against , "Weather" vs "Weather Now", "Events" vs "Upcoming").
 *
 * Each board tile hard-codes its title as a `title="…"` literal in its view's
 * TileHeader, so we read the view source at build time and assert that literal
 * matches the registry label. A source check (vs rendering) needs no per-tile
 * prop wrangling and pins the exact string. Clock is the sole exception: it's a
 * greeting tile with no static header title.
 */
import { describe, expect, it, vi } from "vitest";

// MapLibre (via TeslaTileView, imported transitively by tile-registry) calls
// window.URL.createObjectURL at import time , unavailable in jsdom.
vi.mock("pmtiles", () => ({ Protocol: vi.fn().mockImplementation(() => ({ tile: vi.fn() })) }));
vi.mock("@protomaps/basemaps", () => ({
  layers: vi.fn().mockReturnValue([]),
  namedFlavor: vi.fn().mockReturnValue({}),
}));

import { TILE_REGISTRY } from "../../../lib/tile-registry";

// Tiles whose face carries no static TileHeader title, so their registry label
// is purely a name with no `title="…"` literal to match:
//  - tile_clock renders a live greeting.
const NO_STATIC_TITLE = new Set(["tile_clock"]);

// View source from tiles/ and its subdirectories, plus media/, keyed by bare
// filename. Eager + raw so the assertions are pure string checks with no
// rendering. Tiles may live in components/tiles/, components/tiles/<feature>/,
// or components/media/ (e.g. the photo-booth face lives in tiles/photo-booth/).
const tilesSource = import.meta.glob("../*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const nestedTilesSource = import.meta.glob("../*/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const mediaSource = import.meta.glob("../../media/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

// Merge, normalising each key to bare "../<Name>.tsx" for lookup by component name.
const viewSource: Record<string, string> = { ...tilesSource };
for (const [path, src] of [...Object.entries(nestedTilesSource), ...Object.entries(mediaSource)]) {
  // e.g. "../../media/TvNowPlayingTileView.tsx" or "../photo-booth/PhotoBoothTile.tsx"
  // → key to "../<base>.tsx".
  const base = path.split("/").pop();
  if (base) viewSource[`../${base}`] = src as string;
}

describe("tile registry , label matches rendered title", () => {
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
