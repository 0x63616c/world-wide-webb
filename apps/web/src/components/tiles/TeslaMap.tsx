import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { layers, namedFlavor } from "@protomaps/basemaps";
import { Protocol } from "pmtiles";
import { useEffect, useRef } from "react";
import { HOME_CENTER } from "../../config/home";

// ── Protocol guard ────────────────────────────────────────────────────────────
// The pmtiles protocol must be registered once per page. A module-level Set
// (constructed once, never reassigned) tracks which protocols are registered —
// this avoids duplicate-handler warnings on HMR without a mutable primitive.
const registeredProtocols = new Set<string>();

// HOME_CENTER (public placeholder, single source of truth in config/home.ts)
// is the map fallback when lat/lon are null (car location unavailable / API
// outage) so the map still renders centred rather than a blank grey canvas.

// ── Layer filter ──────────────────────────────────────────────────────────────
// Drop all symbol/label layers: the tile container is ~300×150 px, so labels
// add noise not value. Dropping them also avoids the need for a glyphs endpoint.
function isLabelLayer(layer: { type: string }): boolean {
  return layer.type === "symbol";
}

// ── Style builder ─────────────────────────────────────────────────────────────
function buildStyle(): maplibregl.StyleSpecification {
  const baseLayers = layers("protomaps", namedFlavor("black"), { lang: "en" });
  const filteredLayers = baseLayers.filter((l) => !isLabelLayer(l));

  // Theme adjustments — keep everything dark to match the dashboard palette.
  // Roads are slightly lighter dark lines; major arterials get a very subtle
  // green hint (acc-line colour) without becoming a neon glow.
  const themedLayers = filteredLayers.map((layer) => {
    const l = { ...layer } as maplibregl.LayerSpecification & {
      paint?: Record<string, unknown>;
    };

    // Earth / background fill → match map container background
    if (l.id === "earth") {
      l.paint = { ...(l.paint ?? {}), "fill-color": "#0A0D10" };
    }
    // Water → very dark blue-black
    if (l.id === "water") {
      l.paint = { ...(l.paint ?? {}), "fill-color": "#060C14" };
    }
    // Buildings → slightly lighter than earth, keep subtle
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
    // Major roads (arterials) → subtle green-dark tint
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
    // Any other fill (landuse, landcover, pedestrian, parks, etc.) → blend into
    // the dark base so nothing reads tan/khaki against the dashboard palette.
    // Green spaces keep a barely-there tint so they read as parks, not roads.
    if (l.type === "fill" && l.id !== "earth" && l.id !== "water" && l.id !== "buildings") {
      const greenish =
        typeof l.id === "string" &&
        /park|wood|forest|grass|green|nature|golf|pitch|garden/.test(l.id);
      l.paint = { ...(l.paint ?? {}), "fill-color": greenish ? "#0a1322" : "#0A0D10" };
    }

    return l;
  });

  return {
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
}

// ── Pin marker element ────────────────────────────────────────────────────────
// A CSS-themable teardrop that matches the old SVG pin aesthetic.
function createPinElement(): HTMLElement {
  const el = document.createElement("div");
  // Sized large enough to fully contain the halo + the teardrop's drop-shadow,
  // with overflow visible, so nothing about the marker can be clipped.
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

// ── Component ─────────────────────────────────────────────────────────────────

interface TeslaMapProps {
  lat: number | null;
  lon: number | null;
  place: string;
}

export function TeslaMap({ lat, lon, place }: TeslaMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  // Capture initial lat/lon in refs so the mount effect can read them without
  // listing them as reactive deps — the map is created once; the recenter
  // effect handles all subsequent location changes.
  const initialLatRef = useRef(lat);
  const initialLonRef = useRef(lon);

  // Mount: register protocol, create map + marker
  useEffect(() => {
    if (!containerRef.current) return;

    const initLat = initialLatRef.current;
    const initLon = initialLonRef.current;

    // Register pmtiles protocol once per page
    if (!registeredProtocols.has("pmtiles")) {
      const protocol = new Protocol();
      maplibregl.addProtocol("pmtiles", protocol.tile);
      registeredProtocols.add("pmtiles");
    }

    const center: [number, number] =
      initLon !== null && initLat !== null ? [initLon, initLat] : HOME_CENTER;

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: buildStyle(),
        center,
        zoom: 15,
        // Wall panel: passive view — no user interaction
        dragPan: false,
        scrollZoom: false,
        doubleClickZoom: false,
        touchZoomRotate: false,
        keyboard: false,
        dragRotate: false,
        // Private dev wall panel — drop the on-map attribution badge. (OSM/ODbL
        // attribution would be required if this map were displayed publicly.)
        attributionControl: false,
      });
    } catch (err) {
      // WebGL unavailable (e.g. a headless/GPU-less context). Degrade to the
      // dark container + overlays instead of throwing, which would unmount the
      // whole board. The real wall panel has WebGL, so this is belt-and-braces.
      console.warn("TeslaMap: map init failed; rendering static container", err);
      return;
    }

    mapRef.current = map;

    // Suppress tile-fetch errors (e.g. pmtiles file missing in dev) — the map
    // degrades to a dark canvas instead of spamming the console with stack traces.
    map.on("error", (e) => {
      console.warn("TeslaMap source error:", e.error?.message ?? e);
    });

    // Add pin only when we have a real location
    if (initLon !== null && initLat !== null) {
      const el = createPinElement();
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([initLon, initLat])
        .addTo(map);
      markerRef.current = marker;
    }

    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Recenter + move marker when car location changes
  useEffect(() => {
    if (!mapRef.current || lon === null || lat === null) return;

    mapRef.current.easeTo({ center: [lon, lat], duration: 800 });

    if (markerRef.current) {
      markerRef.current.setLngLat([lon, lat]);
    } else {
      // Marker was not created on mount (no location then) — create it now
      const el = createPinElement();
      markerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([lon, lat])
        .addTo(mapRef.current);
    }
  }, [lat, lon]);

  return (
    <div
      style={{
        position: "relative",
        height: "100%",
        width: "100%",
        borderRadius: 14,
        overflow: "hidden",
        border: "1px solid var(--hair)",
        background: "#0A0D10",
      }}
    >
      {/* MapLibre canvas */}
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

      {/* Location pill — top-left overlay. Hidden when the place is unknown
          (no GPS match and no zone) rather than showing an empty pill. */}
      {place && (
        <span
          className="pill"
          style={{
            position: "absolute",
            left: 12,
            top: 12,
            padding: "4px 10px",
            fontSize: 12,
            background: "rgba(30,34,40,0.85)",
            color: "var(--text-muted, #8a9ab0)",
            borderColor: "transparent",
          }}
        >
          {place}
        </span>
      )}
    </div>
  );
}
