/**
 * ExpandedControlsModalView — the larger control surface the tile's "more"
 * button opens. PURE view: all data + callbacks arrive via props (no trpc/hooks),
 * so it composes trivially in Storybook and component tests.
 *
 * Reuses ControlsGridView (hideMore) for the Lamps/Lights/Fan toggles rather than
 * re-inlining them, then adds lamp-specific controls: four scene presets and a
 * brightness slider. The slider is disabled when lamps are off because HA rejects
 * brightness changes on an off light — surfacing that as a dead control is clearer
 * than firing a request that silently no-ops.
 */

import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { Modal } from "../ui";
import type { ControlKey, ControlsViewData } from "./ControlsTileView";
import { ControlsGridView } from "./ControlsTileView";

// ─── types ────────────────────────────────────────────────────────────────────

export const LampScene = {
  White: "white",
  Mood: "mood",
  Red: "red",
  Blue: "blue",
} as const;
export type LampScene = (typeof LampScene)[keyof typeof LampScene];

// Scene presets in display order. `label` is the exact accessible name the
// wiring + tests rely on; matches the API's setLampScene input union. `swatch`
// is a CSS background previewing the scene's color at a glance — Mood is a
// multi-hue gradient because the service paints each lamp a different color.
const SCENES: { scene: LampScene; label: string; swatch: string }[] = [
  { scene: LampScene.White, label: "White", swatch: "#fff" },
  {
    scene: LampScene.Mood,
    label: "Mood",
    swatch: "linear-gradient(135deg, #a855f7, #3b82f6 55%, #ec4899)",
  },
  { scene: LampScene.Red, label: "Red", swatch: "#ff3b3b" },
  { scene: LampScene.Blue, label: "Blue", swatch: "#2b6bff" },
];

export interface ExpandedControlsModalViewProps {
  open: boolean;
  onClose: () => void;
  data: ControlsViewData;
  onToggle: (key: ControlKey, currentOn: boolean) => void;
  onScene: (scene: LampScene) => void;
  onBrightness: (pct: number) => void;
}

// ─── view ─────────────────────────────────────────────────────────────────────

export function ExpandedControlsModalView({
  open,
  onClose,
  data,
  onToggle,
  onScene,
  onBrightness,
}: ExpandedControlsModalViewProps) {
  const lampsOff = data.lamps.on === false;

  // Local value drives the slider during a drag for smooth motion + an instant
  // readout. The backend mutation (onBrightness) is debounced 400ms so dragging
  // the bar from 50→0 fires ONE request for the settled value, not ~50 — matching
  // ClimateTile's slider debounce. Seeded from data.lamps.brightness and resynced
  // when upstream changes — controlled-from-props with optimistic local state.
  const [brightness, setBrightness] = useState(data.lamps.brightness ?? 0);
  useEffect(() => {
    setBrightness(data.lamps.brightness ?? 0);
  }, [data.lamps.brightness]);

  const brightnessDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (brightnessDebounceRef.current) clearTimeout(brightnessDebounceRef.current);
    };
  }, []);

  return (
    <Modal open={open} onClose={onClose} title="Controls">
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Lamp brightness — pulled to the top as the modal's primary control.
            Disabled when lamps are off (HA rejects brightness on an off light, so
            we surface a dead control rather than a silent no-op). Thick track
            (range-lg) with the label + live % readout on one row above it. */}
        <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <span className="cap">Lamp brightness</span>
            {/* Live percentage so the slider visibly reflects the value as it moves. */}
            <span
              className="mono"
              data-brightness-readout=""
              style={{ fontSize: 15, color: lampsOff ? "var(--ink-3)" : "var(--acc)" }}
            >
              {brightness}%
            </span>
          </div>
          <input
            className="range range-lg"
            type="range"
            min={0}
            max={100}
            value={brightness}
            aria-label="Brightness"
            disabled={lampsOff}
            onChange={(e) => {
              const pct = Number(e.currentTarget.value);
              setBrightness(pct);
              if (brightnessDebounceRef.current) clearTimeout(brightnessDebounceRef.current);
              brightnessDebounceRef.current = setTimeout(() => onBrightness(pct), 400);
            }}
            // --p drives the .range fill gradient (acc up to the value, dim after).
            style={
              {
                opacity: lampsOff ? 0.4 : 1,
                "--p": `${brightness}%`,
              } as CSSProperties
            }
          />
        </section>

        {/* Full toggle grid — reused, not re-inlined. hideMore drops the
            redundant "more" affordance now that we ARE the more surface. */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gridTemplateRows: "1fr 1fr",
            gap: 13,
          }}
        >
          <ControlsGridView data={data} onToggle={onToggle} hideMore />
        </div>

        {/* Lamp scenes — large 2×2 color tiles. A 2×2 grid (not a flex chip row)
            so the tiles read as big tap targets matching the toggle grid above;
            gap 13 keeps the same rhythm as that grid. Order: White, Mood / Red, Blue. */}
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="cap">Lamp scene</span>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 13,
            }}
          >
            {SCENES.map(({ scene, label, swatch }) => (
              <button
                key={scene}
                type="button"
                onClick={() => onScene(scene)}
                aria-label={label}
                style={{
                  // Big tappable surface, same radius/hairline/dark fill as ControlTap
                  // so the scene tiles sit consistently beside the toggle grid.
                  height: 88,
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "0 18px",
                  borderRadius: 15,
                  background: "var(--nest)",
                  border: "1px solid var(--hair)",
                  color: "var(--ink)",
                  font: "inherit",
                  fontSize: 17,
                  fontWeight: 500,
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                {/* Large color swatch previewing the scene. White gets a hairline so
                    it reads on the dark tile; others carry their own hue. Rendered
                    from the SCENES data, not hardcoded per tile. */}
                <span
                  data-scene-swatch=""
                  aria-hidden="true"
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    background: swatch,
                    border: "1px solid var(--hair-2)",
                    flex: "0 0 auto",
                  }}
                />
                {label}
              </button>
            ))}
          </div>
        </section>
      </div>
    </Modal>
  );
}
