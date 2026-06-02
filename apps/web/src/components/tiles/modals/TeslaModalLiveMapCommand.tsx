/**
 * TeslaModalLiveMapCommand — "Live Map & Command" detail modal for the Tesla tile.
 *
 * WHY this layout: the tile's TeslaMap is interaction-disabled by design — a
 * passive read-only status glance. This modal flips that: the map hero fills
 * the top ~480 px and is fully pannable/zoomable, giving the user real
 * exploratory control. Below a hairline divider a compact command bar exposes
 * three real HA callService actions (Lock/Unlock, Start/Stop charging, Find My
 * Car recenter) alongside a haversine distance-to-home readout. Width 980 so
 * the SoCal map breathes at the modal's scale.
 *
 * PURE view: all data + callbacks arrive via props, NO trpc/hooks. Composes
 * trivially in Storybook and unit tests.
 */

import { layers, namedFlavor } from "@protomaps/basemaps";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../../Icon";
import { Modal } from "../../ui";

// ─── home anchor ──────────────────────────────────────────────────────────────
// Home — the car's home. Matches HOME_CENTER in TeslaMap.
// [lon, lat] for maplibre; separate constants for haversine to keep axes clear.
const HOME_LNG = -118.2428;
const HOME_LAT = 34.0537;

// ─── haversine (inlined) ──────────────────────────────────────────────────────
// haversineMiles lives in apps/api (separate workspace, not importable from
// apps/web). Inlined verbatim so the modal has zero cross-workspace deps.
const EARTH_RADIUS_MILES = 3958.8;

function haversineMiles(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h));
}

// ─── map helpers (interaction-enabled variant) ────────────────────────────────
// Module-level Set tracks protocol registration to avoid duplicate-handler
// warnings on HMR — same guard pattern as TeslaMap.
const registeredProtocols = new Set<string>();

function buildInteractiveStyle(): maplibregl.StyleSpecification {
  const baseLayers = layers("protomaps", namedFlavor("black"), { lang: "en" });
  // Keep symbol/label layers — at modal zoom levels street names add value.
  const themedLayers = baseLayers.map((layer) => {
    const l = { ...layer } as maplibregl.LayerSpecification & { paint?: Record<string, unknown> };
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

function createPinElement(): HTMLElement {
  const el = document.createElement("div");
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
      background:radial-gradient(circle, rgba(91,227,125,.30) 0%, rgba(91,227,125,.10) 45%, rgba(91,227,125,0) 70%);
    "></div>
    <svg width="24" height="30" viewBox="0 0 24 30" fill="none" xmlns="http://www.w3.org/2000/svg"
         style="position:relative;z-index:1;overflow:visible;filter:drop-shadow(0 0 6px rgba(91,227,125,.45))">
      <path d="M12 28 C4 18 0 13 0 8 A12 12 0 1 1 24 8 C24 13 20 18 12 28Z" fill="#5be37d"/>
      <circle cx="12" cy="8" r="4.5" fill="#06210F"/>
    </svg>
  `;
  return el;
}

// ─── interactive map sub-component ───────────────────────────────────────────

interface LiveMapProps {
  lat: number | null;
  lon: number | null;
  /** Increments each time "Find My Car" is tapped; effect fires on every
   *  non-zero value so repeated taps all trigger a recenter. */
  recenterTick: number;
}

function LiveMap({ lat, lon, recenterTick }: LiveMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  // Capture initial values so the mount effect is stable (no reactive deps).
  const initialLatRef = useRef(lat);
  const initialLonRef = useRef(lon);

  // Mount: register protocol, create map + marker
  useEffect(() => {
    if (!containerRef.current) return;

    const initLat = initialLatRef.current;
    const initLon = initialLonRef.current;

    if (!registeredProtocols.has("pmtiles")) {
      const protocol = new Protocol();
      maplibregl.addProtocol("pmtiles", protocol.tile);
      registeredProtocols.add("pmtiles");
    }

    const center: [number, number] =
      initLon !== null && initLat !== null ? [initLon, initLat] : [HOME_LNG, HOME_LAT];

    let map: maplibregl.Map;
    try {
      // Interaction is ENABLED here (dragPan, scrollZoom, etc. default true).
      // This is the distinguishing capability vs the tile's locked map.
      map = new maplibregl.Map({
        container: containerRef.current,
        style: buildInteractiveStyle(),
        center,
        zoom: 14,
        attributionControl: false,
      });
    } catch (err) {
      console.warn("LiveMap: map init failed; rendering static container", err);
      return;
    }

    mapRef.current = map;
    map.on("error", (e) => {
      console.warn("LiveMap source error:", e.error?.message ?? e);
    });

    if (initLon !== null && initLat !== null) {
      const el = createPinElement();
      markerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([initLon, initLat])
        .addTo(map);
    }

    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update marker position when car location changes
  useEffect(() => {
    if (!mapRef.current || lon === null || lat === null) return;
    if (markerRef.current) {
      markerRef.current.setLngLat([lon, lat]);
    } else {
      const el = createPinElement();
      markerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([lon, lat])
        .addTo(mapRef.current);
    }
  }, [lat, lon]);

  // Recenter when "Find My Car" is tapped — tick is a stable counter that
  // allows repeated taps (each increment triggers a fresh easeTo).
  useEffect(() => {
    if (recenterTick === 0 || !mapRef.current) return;
    const target: [number, number] =
      lon !== null && lat !== null ? [lon, lat] : [HOME_LNG, HOME_LAT];
    mapRef.current.easeTo({ center: target, zoom: 15, duration: 700 });
  }, [recenterTick, lat, lon]);

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
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}

// ─── types ────────────────────────────────────────────────────────────────────

/**
 * Raw enum from sensor.evee_charging.
 * Passed as-is so the command bar can label the toggle correctly ("Stop" vs
 * "Start") and display the raw state string as a sub-label.
 */
export type ChargingState =
  | "starting"
  | "charging"
  | "stopped"
  | "complete"
  | "disconnected"
  | "no_power";

export interface TeslaModalLiveMapCommandProps {
  open: boolean;
  onClose: () => void;
  /** device_tracker.evee_location lat/lon. Null when car is asleep/unavailable. */
  lat: number | null;
  lon: number | null;
  /** Human-readable place label derived from HA zone or config/places.ts findPlace. */
  place: string;
  /** lock.evee_lock state. */
  locked: boolean;
  /** sensor.evee_charging raw enum. */
  chargingState: ChargingState;
  /** sensor.evee_battery_level (0–100). */
  batteryPct: number;
  /** Fires lock.lock or lock.unlock via ha.callService depending on current state. */
  onToggleLock: () => void;
  /** Fires switch.turn_on or turn_off for EV charge via ha.callService. */
  onToggleCharge: () => void;
}

// ─── internal helpers ─────────────────────────────────────────────────────────

function isCharging(state: ChargingState): boolean {
  return state === "charging" || state === "starting";
}

function distanceToHome(lat: number | null, lon: number | null): string {
  if (lat === null || lon === null) return "— mi";
  const d = haversineMiles(lat, lon, HOME_LAT, HOME_LNG);
  return `${d.toFixed(1)} mi`;
}

// ─── command button ───────────────────────────────────────────────────────────
// Large tap target for the 3-up command bar. Dark fill + hairline border rhythm
// matching ControlTap, but column-layout (icon → label/sub) vs ControlTap's
// on/off status idiom — command actions warrant a different read.

interface CmdButtonProps {
  icon: React.ReactNode;
  label: string;
  sub: string;
  accent?: boolean;
  amber?: boolean;
  onClick: () => void;
  ariaLabel: string;
}

function CmdButton({ icon, label, sub, accent, amber, onClick, ariaLabel }: CmdButtonProps) {
  const subColor = accent ? "var(--acc)" : amber ? "var(--amber)" : "var(--ink-3)";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 10,
        padding: "16px 18px 14px",
        background: "var(--nest)",
        border: "1px solid var(--hair)",
        borderRadius: 15,
        color: "var(--ink)",
        font: "inherit",
        cursor: "pointer",
        minHeight: 88,
        textAlign: "left",
      }}
    >
      {icon}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 16, fontWeight: 500 }}>{label}</span>
        <span
          className="mono"
          style={{
            fontSize: 12,
            color: subColor,
            textTransform: "uppercase",
            letterSpacing: ".07em",
          }}
        >
          {sub}
        </span>
      </div>
    </button>
  );
}

// ─── view ─────────────────────────────────────────────────────────────────────

export function TeslaModalLiveMapCommand({
  open,
  onClose,
  lat,
  lon,
  place,
  locked,
  chargingState,
  batteryPct,
  onToggleLock,
  onToggleCharge,
}: TeslaModalLiveMapCommandProps) {
  // recenterTick drives LiveMap's easeTo effect; increments on each "Find My
  // Car" tap so repeated presses all trigger a fresh animation.
  const [recenterTick, setRecenterTick] = useState(0);

  const charging = isCharging(chargingState);
  const distance = distanceToHome(lat, lon);

  return (
    <Modal open={open} onClose={onClose} title="Tesla" width={980} maxHeight={800}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Map hero — 480 px gives SoCal enough vertical room at width 980.
            Interaction is ENABLED: this is the whole point vs the tile's
            read-only map — the user can pan, zoom, explore context. */}
        <div style={{ height: 480 }}>
          <LiveMap lat={lat} lon={lon} recenterTick={recenterTick} />
        </div>

        {/* Hairline divider separating map from command area. Extends to modal
            edges to echo the header divider's full-width treatment. */}
        <div
          style={{
            height: 1,
            background: "var(--hair)",
            margin: "0 -20px",
          }}
        />

        {/* Distance + location context row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 13,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Icon name="pin" s={16} c="var(--ink-2)" />
            <span style={{ fontSize: 15, color: "var(--ink-2)" }}>
              {place || "Unknown location"}
            </span>
          </div>
          <span
            className="mono"
            data-distance=""
            style={{ fontSize: 15, color: "var(--acc)", fontWeight: 600 }}
          >
            {distance}
          </span>
        </div>

        {/* 3-up command bar: Lock/Unlock · Start/Stop Charge · Find My Car */}
        <div style={{ display: "flex", gap: 13 }}>
          <CmdButton
            ariaLabel={locked ? "Unlock" : "Lock"}
            icon={
              <Icon
                name={locked ? "lock" : "unlock"}
                s={22}
                c={locked ? "var(--ink-2)" : "var(--amber)"}
              />
            }
            label={locked ? "Unlock" : "Lock"}
            sub={locked ? "Locked" : "Unlocked"}
            amber={!locked}
            onClick={onToggleLock}
          />
          <CmdButton
            ariaLabel={charging ? "Stop Charging" : "Start Charging"}
            icon={<Icon name="bolt" s={22} c={charging ? "var(--acc)" : "var(--ink-2)"} />}
            label={charging ? "Stop Charging" : "Start Charging"}
            sub={`${batteryPct}% · ${chargingState}`}
            accent={charging}
            onClick={onToggleCharge}
          />
          <CmdButton
            ariaLabel="Find My Car"
            icon={<Icon name="car" s={22} c="var(--ink-2)" />}
            label="Find My Car"
            sub="Recenter map"
            onClick={() => setRecenterTick((t) => t + 1)}
          />
        </div>
      </div>
    </Modal>
  );
}
