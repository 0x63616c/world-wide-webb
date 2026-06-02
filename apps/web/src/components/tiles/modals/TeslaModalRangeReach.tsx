/**
 * TeslaModalRangeReach — isochrone-style range overlay for the Tesla tile.
 *
 * WHY this layout: the tile already shows a battery % and a range number, but
 * those are abstract scalars. This modal answers the visceral question "where
 * can the car actually get to?" by projecting the range miles as a geo-circle
 * centered on the car's GPS position on the SoCal map. The home pin + distance
 * line turn "can I make it home?" into a spatial yes/no rather than arithmetic.
 *
 * Layout: 980 wide, map dominant (fills ~70% of the height via flex-grow 1),
 * with a slim top-strip showing pct + range + "X mi to home / reachable" verdict
 * pill. Wide modal so the range circle at LA scale isn't clipped at the panel edges.
 *
 * The range circle is a MapLibre GeoJSON fill layer. Miles are converted to
 * metres (the GeoJSON circle source expects metres in the turf-style circle
 * approximation) via a polygon generated client-side — no external dependency,
 * just the parametric circle formula: N points around the arc at radius R.
 *
 * "Can make it home" = range > distToHome with a 5 mi safety buffer. This
 * threshold is intentionally conservative so the amber warning fires early.
 *
 * PURE VIEW — all data + callbacks via props. No trpc/hooks.
 */

import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { layers, namedFlavor } from "@protomaps/basemaps";
import { Protocol } from "pmtiles";
import { useEffect, useRef } from "react";
import { Modal } from "../../ui";

// ── Constants ─────────────────────────────────────────────────────────────────

// Home — the car's home. Duplicated here (also in TeslaMap +
// api/config/places.ts) so this pure-view modal has no cross-package import.
const HOME_LAT = 34.0537;
const HOME_LON = -118.2428;

// Miles → metres conversion for the circle geometry.
const MILES_TO_METRES = 1609.344;

// Number of polygon vertices for the range circle approximation. 64 gives a
// smooth-looking circle without meaningfully increasing GeoJSON payload size.
const CIRCLE_STEPS = 64;

// Safety buffer (miles): warn amber when range is within this margin of the
// home distance. Conservative so the warning fires before it's too tight.
const SAFETY_BUFFER_MILES = 5;

// Protocol registration guard — same pattern as TeslaMap. Module-level Set
// avoids duplicate-handler warnings on HMR while still being side-effect-free.
const registeredProtocols = new Set<string>();

// ── Geometry helpers ──────────────────────────────────────────────────────────

/**
 * Great-circle distance in miles between two lat/lon points (haversine).
 * Inlined here so the component is self-contained (api/config/places.ts is
 * server-only and cannot be imported from the web app directly).
 */
function haversineMiles(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(h));
}

/**
 * Build a GeoJSON Polygon approximating a circle of radiusMiles around a
 * lat/lon centre using the parametric arc formula. Returns coordinates in
 * [lon, lat] order (GeoJSON convention). The polygon is closed (first === last).
 */
function circlePolygon(
  centreLat: number,
  centreLon: number,
  radiusMiles: number,
  steps: number,
): GeoJSON.Polygon {
  const radiusRad = (radiusMiles * MILES_TO_METRES) / 6371000; // earth radius in metres
  const coords: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (2 * Math.PI * i) / steps;
    const lat = centreLat + (radiusRad * Math.cos(angle) * 180) / Math.PI;
    const lon =
      centreLon +
      (radiusRad * Math.sin(angle) * 180) / (Math.PI * Math.cos((centreLat * Math.PI) / 180));
    coords.push([lon, lat]);
  }
  return { type: "Polygon", coordinates: [coords] };
}

// ── Map style (dark, matching dashboard palette) ──────────────────────────────

function buildStyle(): maplibregl.StyleSpecification {
  const baseLayers = layers("protomaps", namedFlavor("black"), { lang: "en" });
  // Keep symbol/label layers on the range modal — the wider map benefits from
  // neighbourhood labels so the user can orient within the reach circle.
  const themedLayers = baseLayers.map((layer) => {
    const l = { ...layer } as maplibregl.LayerSpecification & {
      paint?: Record<string, unknown>;
    };
    if (l.id === "earth") l.paint = { ...(l.paint ?? {}), "fill-color": "#0A0D10" };
    if (l.id === "water") l.paint = { ...(l.paint ?? {}), "fill-color": "#060C14" };
    if (l.id === "buildings")
      l.paint = { ...(l.paint ?? {}), "fill-color": "#0E1318", "fill-opacity": 0.9 };
    if (typeof l.id === "string" && l.id.includes("casing"))
      l.paint = { ...(l.paint ?? {}), "line-color": "#0A0D10" };
    if (typeof l.id === "string" && l.id.includes("minor") && l.type === "line")
      l.paint = { ...(l.paint ?? {}), "line-color": "#171D23" };
    if (
      typeof l.id === "string" &&
      (l.id.includes("major") ||
        l.id.includes("highway") ||
        l.id.includes("trunk") ||
        l.id.includes("primary")) &&
      l.type === "line"
    ) {
      l.paint = { ...(l.paint ?? {}), "line-color": "#1a2820" };
    }
    if (l.type === "fill" && l.id !== "earth" && l.id !== "water" && l.id !== "buildings") {
      const greenish =
        typeof l.id === "string" &&
        /park|wood|forest|grass|green|nature|golf|pitch|garden/.test(l.id);
      l.paint = { ...(l.paint ?? {}), "fill-color": greenish ? "#0d160f" : "#0A0D10" };
    }
    return l;
  });

  return {
    version: 8,
    glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
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

// ── Range-circle map component ─────────────────────────────────────────────────

interface RangeMapProps {
  carLat: number;
  carLon: number;
  rangeMiles: number;
}

function RangeMap({ carLat, carLon, rangeMiles }: RangeMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  // Capture initial values in refs so the mount effect is stable (same pattern
  // as TeslaMap — map created once, update effects handle subsequent changes).
  const initCarLatRef = useRef(carLat);
  const initCarLonRef = useRef(carLon);
  const initRangeRef = useRef(rangeMiles);

  // Mount: register protocol, create map, add range circle + markers.
  useEffect(() => {
    if (!containerRef.current) return;

    if (!registeredProtocols.has("pmtiles")) {
      const protocol = new Protocol();
      maplibregl.addProtocol("pmtiles", protocol.tile);
      registeredProtocols.add("pmtiles");
    }

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: buildStyle(),
        // Zoom out far enough to show the full range circle (LA metro scale).
        // At zoom 10, ~40 miles of SoCal fits comfortably on the 980px panel.
        center: [initCarLonRef.current, initCarLatRef.current],
        zoom: 10,
        // Interactive pan/zoom — user can explore where the range circle reaches.
        dragPan: true,
        scrollZoom: true,
        doubleClickZoom: true,
        touchZoomRotate: true,
        keyboard: true,
        dragRotate: false,
        attributionControl: false,
      });
    } catch (err) {
      console.warn("TeslaModalRangeReach: map init failed", err);
      return;
    }

    mapRef.current = map;
    map.on("error", (e) => {
      console.warn("TeslaModalRangeReach source error:", e.error?.message ?? e);
    });

    map.on("load", () => {
      const circlePoly = circlePolygon(
        initCarLatRef.current,
        initCarLonRef.current,
        initRangeRef.current,
        CIRCLE_STEPS,
      );

      // Range fill — translucent green wash so the map underneath stays readable.
      map.addSource("range-circle", {
        type: "geojson",
        data: { type: "Feature", geometry: circlePoly, properties: {} },
      });
      map.addLayer({
        id: "range-fill",
        type: "fill",
        source: "range-circle",
        paint: {
          "fill-color": "#5be37d",
          "fill-opacity": 0.08,
        },
      });
      // Range border — crisp green hairline so the edge of reach is unambiguous.
      map.addLayer({
        id: "range-border",
        type: "line",
        source: "range-circle",
        paint: {
          "line-color": "#5be37d",
          "line-width": 1.5,
          "line-opacity": 0.55,
        },
      });

      // Distance line: car → home (GeoJSON LineString).
      map.addSource("home-line", {
        type: "geojson",
        data: {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [initCarLonRef.current, initCarLatRef.current],
              [HOME_LON, HOME_LAT],
            ],
          },
          properties: {},
        },
      });
      map.addLayer({
        id: "home-line-dash",
        type: "line",
        source: "home-line",
        paint: {
          "line-color": "#f4c063",
          "line-width": 1.5,
          "line-dasharray": [3, 3],
          "line-opacity": 0.65,
        },
      });
    });

    // Car pin (green teardrop, matching TeslaMap aesthetic).
    const carEl = document.createElement("div");
    carEl.style.cssText =
      "width:44px;height:44px;position:relative;display:flex;align-items:center;justify-content:center;overflow:visible;pointer-events:none;";
    carEl.innerHTML = `
      <div style="position:absolute;inset:0;border-radius:50%;background:radial-gradient(circle,rgba(91,227,125,.28) 0%,rgba(91,227,125,.08) 50%,rgba(91,227,125,0) 70%);"></div>
      <svg width="20" height="25" viewBox="0 0 24 30" fill="none" style="position:relative;z-index:1;filter:drop-shadow(0 0 5px rgba(91,227,125,.4))">
        <path d="M12 28 C4 18 0 13 0 8 A12 12 0 1 1 24 8 C24 13 20 18 12 28Z" fill="#5be37d"/>
        <circle cx="12" cy="8" r="4.5" fill="#06210F"/>
      </svg>`;
    new maplibregl.Marker({ element: carEl })
      .setLngLat([initCarLonRef.current, initCarLatRef.current])
      .addTo(map);

    // Home pin (amber diamond to distinguish from the car pin).
    const homeEl = document.createElement("div");
    homeEl.style.cssText =
      "width:32px;height:32px;display:flex;align-items:center;justify-content:center;overflow:visible;pointer-events:none;";
    homeEl.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style="filter:drop-shadow(0 0 4px rgba(244,192,99,.45))">
        <path d="M10 1 L19 9 L16 9 L16 18 L12 18 L12 13 L8 13 L8 18 L4 18 L4 9 L1 9 Z" fill="#f4c063"/>
      </svg>`;
    new maplibregl.Marker({ element: homeEl }).setLngLat([HOME_LON, HOME_LAT]).addTo(map);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        borderRadius: 14,
        overflow: "hidden",
        border: "1px solid var(--hair)",
        background: "#0A0D10",
      }}
    >
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

      {/* Legend — bottom-right corner so it doesn't compete with the top strip */}
      <div
        style={{
          position: "absolute",
          bottom: 12,
          right: 12,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          padding: "8px 12px",
          borderRadius: 10,
          background: "rgba(12,14,17,0.82)",
          border: "1px solid var(--hair)",
        }}
      >
        <LegendRow color="#5be37d" label="Range circle" />
        <LegendRow color="#f4c063" label="Home" dashed />
      </div>
    </div>
  );
}

function LegendRow({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
      <div
        aria-hidden="true"
        style={{
          width: 18,
          height: 2,
          borderRadius: 1,
          background: dashed ? "transparent" : color,
          borderBottom: dashed ? `2px dashed ${color}` : "none",
          opacity: 0.75,
        }}
      />
      <span style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--mono)" }}>
        {label}
      </span>
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface TeslaModalRangeReachProps {
  open: boolean;
  onClose: () => void;
  // Current battery percentage (sensor.evee_battery_level, 0–100).
  pct: number;
  // Estimated range in miles (sensor.evee_battery_range).
  rangeMiles: number;
  // Live GPS position from device_tracker.evee_location. Null when
  // the car is asleep / API unavailable — map falls back to HOME_CENTER.
  carLat: number | null;
  carLon: number | null;
}

// ── Verdict helpers ───────────────────────────────────────────────────────────

type Verdict = "reachable" | "tight" | "unreachable" | "unknown";

function getVerdict(rangeMiles: number, distMiles: number): Verdict {
  if (rangeMiles >= distMiles + SAFETY_BUFFER_MILES) return "reachable";
  if (rangeMiles >= distMiles) return "tight";
  return "unreachable";
}

const VERDICT_LABEL: Record<Verdict, string> = {
  reachable: "Reachable",
  tight: "Tight — low margin",
  unreachable: "Out of range",
  unknown: "Location unknown",
};

// Pill className suffix for each verdict tone.
// .pill.on = green, .pill.amber = amber, .pill (bare) = dim.
const VERDICT_PILL: Record<Verdict, string> = {
  reachable: "pill on",
  tight: "pill amber",
  unreachable: "pill",
  unknown: "pill",
};

// ── View ──────────────────────────────────────────────────────────────────────

export function TeslaModalRangeReach({
  open,
  onClose,
  pct,
  rangeMiles,
  carLat,
  carLon,
}: TeslaModalRangeReachProps) {
  // Use home as car location fallback when GPS is unavailable, matching the
  // tile's own TeslaMap fallback strategy (HOME_CENTER when lat/lon are null).
  const effectiveLat = carLat ?? HOME_LAT;
  const effectiveLon = carLon ?? HOME_LON;

  const distToHome = haversineMiles(effectiveLat, effectiveLon, HOME_LAT, HOME_LON);
  const verdict: Verdict = carLat === null ? "unknown" : getVerdict(rangeMiles, distToHome);

  return (
    <Modal open={open} onClose={onClose} title="Tesla" width={980} maxHeight={720}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Top strip: key numbers + verdict pill — uniform 24-gap rhythm */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 13,
            flexWrap: "wrap",
          }}
        >
          {/* Battery % badge */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 3,
              minWidth: 60,
            }}
          >
            <span className="cap">Battery</span>
            <span className="mono" style={{ fontSize: 22, fontWeight: 700, color: "var(--ink)" }}>
              {pct}%
            </span>
          </div>

          <div style={{ width: 1, height: 32, background: "var(--hair)" }} />

          {/* Range badge */}
          <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 80 }}>
            <span className="cap">Est. range</span>
            <span className="mono" style={{ fontSize: 22, fontWeight: 700, color: "var(--ink)" }}>
              {rangeMiles} mi
            </span>
          </div>

          <div style={{ width: 1, height: 32, background: "var(--hair)" }} />

          {/* Distance to home badge */}
          <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 80 }}>
            <span className="cap">To home</span>
            <span
              className="mono"
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: carLat === null ? "var(--ink-3)" : "var(--ink)",
              }}
            >
              {carLat === null ? "—" : `${Math.round(distToHome)} mi`}
            </span>
          </div>

          {/* Verdict pill — pushed to the right of the strip */}
          <div style={{ marginLeft: "auto" }}>
            <span className={VERDICT_PILL[verdict]}>{VERDICT_LABEL[verdict]}</span>
          </div>
        </div>

        {/* Map — flex-grow 1 so it fills remaining vertical space up to maxHeight.
            Fixed pixel height of 560 balances the top strip (≈112px) + padding
            within the 720px maxHeight, keeping the modal proportional. */}
        <div style={{ height: 500 }}>
          <RangeMap carLat={effectiveLat} carLon={effectiveLon} rangeMiles={rangeMiles} />
        </div>
      </div>
    </Modal>
  );
}
