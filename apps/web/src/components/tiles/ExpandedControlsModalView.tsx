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
import { ControlTap, Modal } from "@/components/ui";
import type { ControlKey, ControlsViewData } from "./ControlsTileView";
import { ControlsGridView } from "./ControlsTileView";
import { PartySpeed, PartySpeedSegmented } from "./modals/PartySpeedControls";

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
// is a CSS color previewing the scene at a glance — Mood is a multi-hue gradient
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

// Party tile swatch — a multi-hue wheel signalling the animated party mode.
const PARTY_SWATCH = "conic-gradient(#ff3b3b, #ffb800, #38d39f, #2b6bff, #a855f7, #ff3b3b)";

export interface ExpandedControlsModalViewProps {
  open: boolean;
  onClose: () => void;
  data: ControlsViewData;
  onToggle: (key: ControlKey, currentOn: boolean) => void;
  onScene: (scene: LampScene) => void;
  onBrightness: (pct: number) => void;
  /** Toggle party mode. Wired to setLampMode by ControlsTile (www-7d5b.3.7);
   *  optional so callers/tests that predate party still type-check. */
  onParty?: () => void;
  /** Current party animation speed — seeds the speed control shown while party
   *  is active. Defaults to Medium when unset. */
  speed?: PartySpeed;
  /** Change the party speed (re-issues setLampMode with the new speed). */
  onSpeed?: (speed: PartySpeed) => void;
}

// ─── view ─────────────────────────────────────────────────────────────────────

export function ExpandedControlsModalView({
  open,
  onClose,
  data,
  onToggle,
  onScene,
  onBrightness,
  onParty,
  speed,
  onSpeed,
}: ExpandedControlsModalViewProps) {
  const lampsOff = data.lamps.on === false;
  const activeScene = data.lamps.activeScene ?? null;
  const partyActive = activeScene === "party";

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

        {/* Lamp scenes — ControlTap tiles (swatch variant) so scenes share the
            exact tap styling + active highlight as the toggle grid above. The
            active scene's tile lights (on=activeScene===scene). A 2-col grid keeps
            the same rhythm (gap 13). Each tile is fixed-height so the ControlTap's
            100%-height fill resolves. Order: White, Mood / Red, Blue / Party. */}
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

            {/* Party — same ControlTap surface; disabled (dimmed, no-op) when the
                lamps are off, since party needs at least one lamp lit. Active when
                party mode is running. onToggle toggles party via onParty. */}
            <ControlTap
              icon="bulb"
              swatch={PARTY_SWATCH}
              label="Party"
              on={partyActive}
              disabled={lampsOff}
              onToggle={() => onParty?.()}
            />
          </div>

          {/* Party speed — only meaningful while party is running, so it appears
              under the scene grid when active. Segmented Slow/Med/Fast is the
              shipping control (the slider + tap-cycle variants live in Storybook
              for Calum to feel; all three are prop-compatible). */}
          {partyActive && onSpeed && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
              <span className="cap">Party speed</span>
              <PartySpeedSegmented value={speed ?? PartySpeed.Medium} onChange={onSpeed} />
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
