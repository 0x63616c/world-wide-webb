/**
 * TeslaModalLiveMapCommand , "Live Map & Command" detail modal for the Tesla tile.
 *
 * WHY this layout: the tile's TeslaMap is interaction-disabled by design , a
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

import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { HOME_LAT, HOME_LON } from "@/config/home";
import { buildDarkStyle, createCarPinElement, registerPmtilesProtocol } from "@/lib/maps/protomaps";

// ─── home anchor ──────────────────────────────────────────────────────────────
// Public placeholder home center (single source of truth: config/home.ts).
// Aliased to HOME_LNG locally to keep the maplibre [lon, lat] axes clear.
const HOME_LNG = HOME_LON;

// ─── haversine (inlined) ──────────────────────────────────────────────────────
// haversineMiles lives in api (separate workspace, not importable from
// web). Inlined verbatim so the modal has zero cross-workspace deps.
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

    // Register pmtiles protocol once per page (idempotent)
    registerPmtilesProtocol();

    const center: [number, number] =
      initLon !== null && initLat !== null ? [initLon, initLat] : [HOME_LNG, HOME_LAT];

    let map: maplibregl.Map;
    try {
      // Interaction is ENABLED here (dragPan, scrollZoom, etc. default true).
      // This is the distinguishing capability vs the tile's locked map.
      // Labels are kept (includeLabels: true) , at modal zoom levels street names add value.
      map = new maplibregl.Map({
        container: containerRef.current,
        style: buildDarkStyle({ includeLabels: true }),
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
      const el = createCarPinElement();
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
      const el = createCarPinElement();
      markerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([lon, lat])
        .addTo(mapRef.current);
    }
  }, [lat, lon]);

  // Recenter when "Find My Car" is tapped , tick is a stable counter that
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
  if (lat === null || lon === null) return ", mi";
  const d = haversineMiles(lat, lon, HOME_LAT, HOME_LNG);
  return `${d.toFixed(1)} mi`;
}

// ─── command button ───────────────────────────────────────────────────────────
// Large tap target for the 3-up command bar. Dark fill + hairline border rhythm
// matching ControlTap, but column-layout (icon → label/sub) vs ControlTap's
// on/off status idiom , command actions warrant a different read.

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
    <div style={{ maxWidth: 920, margin: "0 auto" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Map hero , 480 px gives SoCal enough vertical room at width 980.
            Interaction is ENABLED: this is the whole point vs the tile's
            read-only map , the user can pan, zoom, explore context. */}
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
    </div>
  );
}
