/**
 * ExpandedControlsView , the larger control surface the Controls tile
 * opens. PURE view: all data + callbacks arrive via props (no trpc/hooks),
 * so it composes trivially in component tests.
 *
 * Reuses ControlsGridView (hideMore) for the Lamps/Lights/Fan toggles rather than
 * re-inlining them, then adds lamp-specific controls: scene presets and a
 * brightness slider. The slider is disabled when lamps are off because HA rejects
 * brightness changes on an off light , surfacing that as a dead control is clearer
 * than firing a request that silently no-ops.
 *
 * Bare page body (no <Modal>) , hosted by TileDetailHost, which supplies the
 * page shell and header; live data comes from detail/wiring/controls.tsx.
 */

import { useEffect, useRef, useState } from "react";
import { HexColorInput, HexColorPicker } from "react-colorful";
import { ControlTap, Slider } from "@/components/ui";
import type {
  ControlKey,
  ControlsViewData,
  SavedColorSlot,
  SavedLampColorView,
} from "./ControlsTileView";
import { CONTROLS_GRID_HEIGHT, ControlsGridView } from "./ControlsTileView";
import type { PartySelection } from "./views/PartySpeedControls";
import { PartyControl, PartySpeed } from "./views/PartySpeedControls";

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
// is a CSS color previewing the scene at a glance , Mood is a multi-hue gradient
// because the service paints each lamp a different color. White is a warm tone
// (#fff4e0) reflecting the warmer 4000K white scene, not a clinical pure white.
const SCENES: { scene: LampScene; label: string; swatch: string }[] = [
  { scene: LampScene.White, label: "White", swatch: "#fff4e0" },
  {
    scene: LampScene.Mood,
    label: "Mood",
    swatch: "linear-gradient(135deg, #a855f7, #3b82f6 55%, #ec4899)",
  },
];

const DEFAULT_SAVED_COLORS: SavedLampColorView[] = [
  { slot: "red", label: "Red", hex: "#ff0000" },
  { slot: "blue", label: "Blue", hex: "#0066ff" },
  { slot: "custom", label: "Custom", hex: "#8b5cf6" },
];

/**
 * What a saved colour is CALLED on the panel: "Custom 1/2/3", by position.
 *
 * The three slots are named `red`/`blue`/`custom` on the wire (they started as
 * fixed scenes), and the service still labels them that way. Once every slot
 * became freely editable those names stopped being true , the "Red" swatch is
 * whatever you last put in it , so the face numbers them instead of repeating a
 * colour name that may be a lie. The slot ids are untouched; this is display
 * only.
 */
function savedColorLabel(index: number): string {
  return `Custom ${index + 1}`;
}

export interface ExpandedControlsViewProps {
  data: ControlsViewData;
  onToggle: (key: ControlKey, currentOn: boolean) => void;
  onScene: (scene: LampScene) => void;
  onBrightness: (pct: number) => void;
  onColor?: (slot: SavedColorSlot) => void;
  onSaveColor?: (slot: SavedColorSlot, hex: string) => void;
  /** Current party animation speed , seeds the party control's active segment
   *  while party is running. Defaults to Medium when unset. */
  speed?: PartySpeed;
  /** Drive the full-width party control: "off" stops party, a speed starts (or
   *  re-speeds) it. Wired to setLampMode by ControlsTile; optional so callers/tests
   *  that predate party still type-check. */
  onPartySelect?: (value: PartySelection) => void;
}

// ─── view ─────────────────────────────────────────────────────────────────────

export function ExpandedControlsView({
  data,
  onToggle,
  onScene,
  onBrightness,
  onColor,
  onSaveColor,
  speed,
  onPartySelect,
}: ExpandedControlsViewProps) {
  const lampsOff = data.lamps.on === false;
  const activeScene = data.lamps.activeScene ?? null;
  const partyActive = activeScene === "party";
  const savedColors = data.lamps.savedColors ?? DEFAULT_SAVED_COLORS;
  const [editingColors, setEditingColors] = useState(false);
  const [editingColor, setEditingColor] = useState<{
    color: SavedLampColorView;
    label: string;
  } | null>(null);
  const [draftColor, setDraftColor] = useState("");

  // Local value drives the slider during a drag for smooth motion + an instant
  // readout. The backend mutation (onBrightness) is debounced 400ms so dragging
  // the bar from 50→0 fires ONE request for the settled value, not ~50 , matching
  // ClimateTile's slider debounce. Seeded from data.lamps.brightness and resynced
  // when upstream changes , controlled-from-props with optimistic local state.
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
    <div style={{ maxWidth: 920, margin: "0 auto" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Lamp brightness , pulled to the top as the modal's primary control.
            Disabled when lamps are off (HA rejects brightness on an off light, so
            we surface a dead control rather than a silent no-op). Thick track
            (range-lg) with the label + live % readout on one row above it. */}
        <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
            }}
          >
            <span className="cap">Lamp brightness</span>
            {/* Live percentage so the slider visibly reflects the value as it moves. */}
            <span
              className="mono"
              data-brightness-readout=""
              style={{
                fontSize: 15,
                color: lampsOff ? "var(--ink-3)" : "var(--acc)",
              }}
            >
              {brightness}%
            </span>
          </div>
          <Slider
            value={brightness}
            min={0}
            max={100}
            label="Brightness"
            showHeader={false}
            size="lg"
            disabled={lampsOff}
            onChange={(pct) => {
              setBrightness(pct);
              if (brightnessDebounceRef.current) clearTimeout(brightnessDebounceRef.current);
              brightnessDebounceRef.current = setTimeout(() => onBrightness(pct), 400);
            }}
          />
        </section>

        {/* Full toggle surface , reused, not re-inlined. hideMore drops the
            redundant "more" affordance now that we ARE the more surface, and
            trims the utility row to just All + Fan. Same utility-row + group-
            card layout as the compact tile (Option 3, "Group Cards"), just a
            fixed height (CONTROLS_GRID_HEIGHT , every cell inside is now a
            fixed CELL_H, so this must be tall enough to hold them without a
            gap at the bottom) since, unlike the compact tile, nothing here
            sizes this view from a board grid cell. */}
        <div style={{ height: CONTROLS_GRID_HEIGHT }}>
          <ControlsGridView data={data} onToggle={onToggle} hideMore />
        </div>

        {/* Lamp scenes , ControlTap tiles (swatch variant) so scenes share the
            exact tap styling + active highlight as the toggle grid above. The
            active scene's tile lights (on=activeScene===scene). A 2-col grid keeps
            the same rhythm (gap 13). Each tile is fixed-height so the ControlTap's
            100%-height fill resolves. Order: White, Mood / Red, Blue. */}
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="cap">Lamp scene</span>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gridAutoRows: 88,
              gap: 13,
            }}
          >
            {SCENES.map(({ scene, label, swatch }) => (
              <ControlTap
                key={scene}
                icon="bulb"
                swatch={swatch}
                label={label}
                on={activeScene === scene}
                onToggle={() => onScene(scene)}
              />
            ))}
          </div>
        </section>

        {onColor && onSaveColor && (
          <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
              }}
            >
              <span className="cap">Colors</span>
              <button
                type="button"
                aria-pressed={editingColors}
                onClick={() => setEditingColors((editing) => !editing)}
                style={{
                  padding: 0,
                  border: 0,
                  background: "none",
                  color: "var(--ink-2)",
                  cursor: "pointer",
                  font: "inherit",
                  fontSize: 13,
                }}
              >
                {editingColors ? "Done" : "Edit"}
              </button>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-around",
                gap: 20,
              }}
            >
              {savedColors.map((color, index) => {
                const label = savedColorLabel(index);
                const editColor = () => {
                  setEditingColor({ color, label });
                  setDraftColor(color.hex);
                };
                return (
                  <button
                    key={color.slot}
                    type="button"
                    aria-label={`${editingColors ? "Edit" : "Use"} ${label}`}
                    onClick={() => (editingColors ? editColor() : onColor(color.slot))}
                    style={{
                      width: 86,
                      height: 86,
                      borderRadius: "50%",
                      border: editingColors ? "3px solid var(--acc)" : "3px solid var(--hair-2)",
                      background: color.hex,
                      boxShadow: "inset 0 0 0 1px rgba(255,255,255,.35)",
                      cursor: "pointer",
                    }}
                  />
                );
              })}
            </div>
          </section>
        )}

        {/* Party , one full-width control folding the on/off toggle and the speed
            picker into a single Off / Slow / Med / Fast row. Disabled (dimmed) when
            lamps are off, since party needs at least one lamp lit. "off" when party
            isn't running; otherwise the active speed segment lights. */}
        {onPartySelect && (
          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <span className="cap">Party</span>
            <PartyControl
              value={partyActive ? (speed ?? PartySpeed.Medium) : "off"}
              onSelect={onPartySelect}
              disabled={lampsOff}
            />
          </section>
        )}
      </div>
      {editingColor && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Edit ${editingColor.label} color`}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10,
            display: "grid",
            placeItems: "center",
            padding: 24,
            background: "rgba(0,0,0,.65)",
          }}
        >
          <div
            style={{
              width: "min(100%, 420px)",
              padding: 24,
              borderRadius: 24,
              background: "var(--tile)",
              boxShadow: "0 20px 60px rgba(0,0,0,.45)",
              display: "flex",
              flexDirection: "column",
              gap: 18,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span className="cap">Edit {editingColor.label}</span>
              <span
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  background: draftColor,
                }}
              />
            </div>
            <HexColorPicker
              color={draftColor}
              onChange={setDraftColor}
              style={{ width: "100%", height: 300 }}
            />
            <HexColorInput
              color={draftColor}
              onChange={setDraftColor}
              prefixed
              aria-label="Hex color"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "14px 16px",
                borderRadius: 12,
                border: "1px solid var(--hair-2)",
                background: "var(--tile-2)",
                color: "var(--ink)",
                font: "inherit",
                fontSize: 18,
              }}
            />
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              <button
                type="button"
                onClick={() => setEditingColor(null)}
                style={{
                  minHeight: 52,
                  borderRadius: 14,
                  border: "1px solid var(--hair-2)",
                  background: "none",
                  color: "var(--ink)",
                  font: "inherit",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onSaveColor?.(editingColor.color.slot, draftColor);
                  setEditingColor(null);
                }}
                style={{
                  minHeight: 52,
                  borderRadius: 14,
                  border: 0,
                  background: "var(--acc)",
                  color: "var(--ink-on-acc)",
                  font: "inherit",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Save & use
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
