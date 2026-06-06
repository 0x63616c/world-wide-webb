import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import { HOME_CENTER } from "@/config/home";
import { buildDarkStyle, createCarPinElement, registerPmtilesProtocol } from "@/lib/maps/protomaps";

// HOME_CENTER (public placeholder, single source of truth in config/home.ts)
// is the map fallback when lat/lon are null (car location unavailable / API
// outage) so the map still renders centred rather than a blank grey canvas.

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

    // Register pmtiles protocol once per page (idempotent)
    registerPmtilesProtocol();

    const center: [number, number] =
      initLon !== null && initLat !== null ? [initLon, initLat] : HOME_CENTER;

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: buildDarkStyle({ includeLabels: false }),
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
      const el = createCarPinElement();
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
      const el = createCarPinElement();
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
