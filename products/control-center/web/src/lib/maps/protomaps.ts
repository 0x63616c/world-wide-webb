/**
 * Shared MapLibre + PMTiles bootstrap helpers used by TeslaMap,
 * TeslaModalLiveMapCommand, and TeslaModalRangeReach.
 *
 * WHY a shared module: all three components initialise a MapLibre instance
 * with the same dark dashboard palette, the same pmtiles protocol guard, and
 * the same blue-teardrop car-pin element. Inlining copies led to drift (the
 * interactive modal had a slightly different road-colour pass than the tile map).
 * Extracting here gives a single source of truth so future palette tweaks are
 * applied everywhere at once.
 *
 * Three exports:
 *  - registerPmtilesProtocol() , idempotent protocol guard (safe to call from
 *    multiple component mounts)
 *  - buildDarkStyle(opts) , returns a StyleSpecification with the dashboard dark
 *    palette; opts.includeLabels keeps symbol layers for wider-zoom modals
 *  - createCarPinElement() , returns the blue-teardrop HTMLElement used as a
 *    MapLibre Marker
 */

import { layers, namedFlavor } from "@protomaps/basemaps";
import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";

// ─── Protocol guard ───────────────────────────────────────────────────────────
// A module-level Set (constructed once, never reassigned) tracks which
// protocols are registered. Safe across HMR because the module is preserved;
// registering twice would cause a "duplicate handler" console warning.
const _registeredProtocols = new Set<string>();

/**
 * Register the pmtiles:// protocol with MapLibre exactly once per page.
 * Idempotent: safe to call from every map component's mount effect.
 */
export function registerPmtilesProtocol(): void {
  if (!_registeredProtocols.has("pmtiles")) {
    const protocol = new Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);
    _registeredProtocols.add("pmtiles");
  }
}

// ─── Style builder ────────────────────────────────────────────────────────────

export interface BuildDarkStyleOpts {
  /**
   * Keep symbol/label layers in the style.
   * - false (default): drop all symbol layers. Correct for small tile maps where
   *   labels add noise without value and would require a glyphs endpoint.
   * - true: keep labels for wider-zoom modals where street names orient the user.
   */
  includeLabels?: boolean;
  /**
   * URL to a glyphs endpoint. Required when includeLabels is true and the base
   * style has symbol layers. Defaults to the OpenMapTiles hosted endpoint.
   */
  glyphsUrl?: string;
}

/**
 * Build a MapLibre StyleSpecification with the dashboard dark palette.
 * All tile components use this so colour tweaks are applied everywhere at once.
 */
export function buildDarkStyle(opts: BuildDarkStyleOpts = {}): maplibregl.StyleSpecification {
  const { includeLabels = false, glyphsUrl } = opts;

  const baseLayers = layers("protomaps", namedFlavor("black"), { lang: "en" });

  // Drop symbol layers when labels are not wanted (tile map, compact modals).
  const visibleLayers = includeLabels ? baseLayers : baseLayers.filter((l) => l.type !== "symbol");

  // Dashboard colour pass , keep everything dark to match the --tile palette.
  const themedLayers = visibleLayers.map((layer) => {
    const l = { ...layer } as maplibregl.LayerSpecification & {
      paint?: Record<string, unknown>;
    };

    // Earth / background → match the map container background
    if (l.id === "earth") {
      l.paint = { ...(l.paint ?? {}), "fill-color": "#0A0D10" };
    }
    // Water → very dark blue-black
    if (l.id === "water") {
      l.paint = { ...(l.paint ?? {}), "fill-color": "#060C14" };
    }
    // Buildings → slightly lighter than earth, subtle
    if (l.id === "buildings") {
      l.paint = { ...(l.paint ?? {}), "fill-color": "#0E1318", "fill-opacity": 0.9 };
    }
    // Road casings (outlines) → dark border
    if (typeof l.id === "string" && l.id.includes("casing")) {
      l.paint = { ...(l.paint ?? {}), "line-color": "#0A0D10" };
    }
    // Minor roads → muted dark lines
    if (typeof l.id === "string" && l.id.includes("minor") && l.type === "line") {
      l.paint = { ...(l.paint ?? {}), "line-color": "#171D23" };
    }
    // Major roads (arterials) → subtle blue-dark tint
    if (
      typeof l.id === "string" &&
      (l.id.includes("major") ||
        l.id.includes("highway") ||
        l.id.includes("trunk") ||
        l.id.includes("primary")) &&
      l.type === "line"
    ) {
      l.paint = { ...(l.paint ?? {}), "line-color": "#13243d" };
    }
    // Other fills (landuse, parks, etc.) → blend into dark base.
    // Green spaces keep a barely-there tint so they read as parks, not roads.
    if (l.type === "fill" && l.id !== "earth" && l.id !== "water" && l.id !== "buildings") {
      const greenish =
        typeof l.id === "string" &&
        /park|wood|forest|grass|green|nature|golf|pitch|garden/.test(l.id);
      l.paint = { ...(l.paint ?? {}), "fill-color": greenish ? "#0a1322" : "#0A0D10" };
    }

    return l;
  });

  const style: maplibregl.StyleSpecification = {
    version: 8,
    sources: {
      protomaps: {
        type: "vector",
        url: "pmtiles:///maps/socal.pmtiles",
        attribution: "© <a href='https://openstreetmap.org/copyright'>OpenStreetMap</a>",
      },
    },
    layers: themedLayers as maplibregl.LayerSpecification[],
  };

  // Only include glyphs when labels are present , prevents a console error for
  // the label-free style which has no symbol layers that need glyph data.
  if (includeLabels) {
    style.glyphs = glyphsUrl ?? "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf";
  }

  return style;
}

// ─── Car pin element ──────────────────────────────────────────────────────────

/**
 * Create the blue-teardrop HTMLElement used as the MapLibre Marker for the car
 * position. The element is intentionally not cached , MapLibre owns the DOM node
 * once it is passed to new Marker({ element }), and each marker instance needs
 * its own element.
 */
export function createCarPinElement(): HTMLElement {
  const el = document.createElement("div");
  // Sized large enough to contain the halo and drop-shadow without clipping.
  el.style.cssText = `
    width: 56px;
    height: 56px;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: visible;
    pointer-events: none;
  `;
  el.innerHTML = `
    <div style="
      position:absolute;
      inset:0;
      border-radius:50%;
      background:radial-gradient(circle, rgba(0, 112, 243,.30) 0%, rgba(0, 112, 243,.10) 45%, rgba(0, 112, 243,0) 70%);
    "></div>
    <svg width="24" height="30" viewBox="0 0 24 30" fill="none" xmlns="http://www.w3.org/2000/svg"
         style="position:relative;z-index:1;overflow:visible;filter:drop-shadow(0 0 6px rgba(0, 112, 243,.45))">
      <path d="M12 28 C4 18 0 13 0 8 A12 12 0 1 1 24 8 C24 13 20 18 12 28Z" fill="#0070f3"/>
      <circle cx="12" cy="8" r="4.5" fill="#04193a"/>
    </svg>
  `;
  return el;
}
