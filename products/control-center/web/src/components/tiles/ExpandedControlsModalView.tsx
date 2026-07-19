/**
 * ExpandedControlsModalView , the larger control surface the tile's "more"
 * button opens. PURE view: all data + callbacks arrive via props (no trpc/hooks),
 * so it composes trivially in Storybook and component tests.
 *
 * Reuses ControlsGridView (hideMore) for the Lamps/Lights/Fan toggles rather than
 * re-inlining them, then adds lamp-specific controls: four scene presets and a
 * brightness slider. The slider is disabled when lamps are off because HA rejects
 * brightness changes on an off light , surfacing that as a dead control is clearer
 * than firing a request that silently no-ops.
 */

import { useEffect, useRef, useState } from "react";
import { ControlTap, Modal, Slider } from "@/components/ui";
import type { ControlKey, ControlsViewData } from "./ControlsTileView";
import { ControlsGridView } from "./ControlsTileView";
import type { PartySelection } from "./modals/PartySpeedControls";
import { PartyControl, PartySpeed } from "./modals/PartySpeedControls";

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
  { scene: LampScene.Red, label: "Red", swatch: "#ff3b3b" },
  { scene: LampScene.Blue, label: "Blue", swatch: "#2b6bff" },
];

export interface ExpandedControlsModalViewProps {
  open: boolean;
  onClose: () => void;
  data: ControlsViewData;
  onToggle: (key: ControlKey, currentOn: boolean) => void;
  /** Advance the Lights mode cycle one step (OFF → K ON → O ON → ON → OFF). */
  onLightsCycle: () => void;
  onScene: (scene: LampScene) => void;
  onBrightness: (pct: number) => void;
  /** Current party animation speed , seeds the party control's active segment
   *  while party is running. Defaults to Medium when unset. */
  speed?: PartySpeed;
  /** Drive the full-width party control: "off" stops party, a speed starts (or
   *  re-speeds) it. Wired to setLampMode by ControlsTile; optional so callers/tests
   *  that predate party still type-check. */
  onPartySelect?: (value: PartySelection) => void;
}

// ─── view ─────────────────────────────────────────────────────────────────────

export function ExpandedControlsModalView({
  open,
  onClose,
  data,
  onToggle,
  onLightsCycle,
  onScene,
  onBrightness,
  speed,
  onPartySelect,
}: ExpandedControlsModalViewProps) {
  const lampsOff = data.lamps.on === false;
  const activeScene = data.lamps.activeScene ?? null;
  const partyActive = activeScene === "party";

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
    <Modal open={open} onClose={onClose} title="Controls">
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Lamp brightness , pulled to the top as the modal's primary control.
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

        {/* Full toggle grid , reused, not re-inlined. hideMore drops the
            redundant "more" affordance now that we ARE the more surface. */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gridTemplateRows: "1fr 1fr",
            gap: 13,
          }}
        >
          <ControlsGridView
            data={data}
            onToggle={onToggle}
            onLightsCycle={onLightsCycle}
            hideMore
          />
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
    </Modal>
  );
}
