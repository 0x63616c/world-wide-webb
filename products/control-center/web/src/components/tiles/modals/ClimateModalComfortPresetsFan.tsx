/**
 * ClimateModalComfortPresetsFan , "Presets & Airflow" detail modal for the Climate tile.
 *
 * WHY this layout: the tile surface exposes only mode (off/cool/heat/heat_cool) and a
 * setpoint slider. Two HA capabilities exist on every climate entity but have ZERO
 * presence in the tile:
 *   1. preset_mode (eco / away / home / boost) , energy / comfort profiles
 *   2. fan_mode (auto / low / medium / high) , airflow control
 *
 * This modal adds both control axes in the narrowest coherent layout. Three sections
 * top-to-bottom: Preset chips → Fan chips → Active zones list. The sections share a
 * single 24px gap rhythm (sections) / 13px (inner grids) / 10px (label → control),
 * matching the Controls modal exactly.
 *
 * Fan and preset both operate per-entity; the modal shows one entity at a time via a
 * tab-style zone selector so the user can tune each zone individually. The "Active now"
 * footer lists ALL zones with a live hvac_action badge so you see the house at a glance
 * without switching tabs.
 *
 * Width 560 , a narrow list/chip concept; no wide graph or map so there is no reason
 * to grow beyond the default.
 *
 * PURE view: all data + callbacks arrive via props , no trpc/hooks. Composes
 * trivially in Storybook and component tests.
 */

import { useState } from "react";
import { Chip, StatusDot } from "@/components/ui";

// ─── types ────────────────────────────────────────────────────────────────────

/** The subset of HA climate entity attributes this modal needs. */
export interface ClimateZone {
  /** HA entity id, e.g. "climate.living_room" */
  entityId: string;
  /** Human-readable label, e.g. "Living Room" */
  label: string;
  /** Active hvac_action from HA ("cooling" | "heating" | "idle" | "off") */
  hvacAction: "cooling" | "heating" | "idle" | "off";
  /** Currently active preset, e.g. "eco" */
  presetMode: string;
  /** Available presets advertised by this entity */
  presetModes: string[];
  /** Currently active fan mode, e.g. "auto" */
  fanMode: string;
  /** Available fan modes advertised by this entity */
  fanModes: string[];
}

export interface ClimateModalComfortPresetsFanProps {
  /** All climate zones in the home */
  zones: ClimateZone[];
  /** Called when the user picks a preset for a zone */
  onSetPreset: (entityId: string, preset: string) => void;
  /** Called when the user picks a fan mode for a zone */
  onSetFan: (entityId: string, fanMode: string) => void;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

// Capitalise first letter for display , preset/fan labels from HA are lowercase.
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Map hvac_action to a compact label and active state for the status list.
function actionLabel(action: ClimateZone["hvacAction"]): string {
  switch (action) {
    case "cooling":
      return "Cooling";
    case "heating":
      return "Heating";
    case "idle":
      return "Idle";
    case "off":
      return "Off";
  }
}

// "cooling" / "heating" are genuinely running; idle and off are not.
function isActive(action: ClimateZone["hvacAction"]): boolean {
  return action === "cooling" || action === "heating";
}

// ─── view ─────────────────────────────────────────────────────────────────────

export function ClimateModalComfortPresetsFan({
  zones,
  onSetPreset,
  onSetFan,
}: ClimateModalComfortPresetsFanProps) {
  // Zone tab index , default to first zone.
  const [activeIdx, setActiveIdx] = useState(0);

  const zone = zones[activeIdx] ?? zones[0];

  return (
    <div style={{ maxWidth: 920, margin: "0 auto" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Zone selector tabs , only shown when there are multiple zones so
            single-zone households get a cleaner surface. Gap 13 keeps the tab
            row on the same rhythm as the inner chip grids. */}
        {zones.length > 1 && (
          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <span className="cap">Zone</span>
            <div style={{ display: "flex", gap: 8 }}>
              {zones.map((z, i) => (
                <Chip key={z.entityId} active={i === activeIdx} onClick={() => setActiveIdx(i)}>
                  {z.label}
                </Chip>
              ))}
            </div>
          </section>
        )}

        {/* Section 1 , Preset. One chip per advertised preset_mode; the active
            one lights up .on. Applying a preset to a zone sets the profile
            (eco saves energy, boost maximises output). Gap 10 between label
            and chips matches the Controls modal's label→control rhythm. */}
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="cap">Preset</span>
          {zone ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {zone.presetModes.map((preset) => (
                <Chip
                  key={preset}
                  active={zone.presetMode === preset}
                  onClick={() => onSetPreset(zone.entityId, preset)}
                >
                  {cap(preset)}
                </Chip>
              ))}
            </div>
          ) : (
            <span style={{ fontSize: 13, color: "var(--ink-3)" }}>No presets available</span>
          )}
        </section>

        {/* Section 2 , Fan. Segmented chip group from fan_modes array. Auto is
            the least-noisy default; low/medium/high let the user override when
            the thermostat's auto logic isn't circulating enough. Gap 13 between
            chips keeps the row on the same inner-grid rhythm as Controls. */}
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="cap">Fan</span>
          {zone ? (
            <div style={{ display: "flex", gap: 8 }}>
              {zone.fanModes.map((fan) => (
                <Chip
                  key={fan}
                  active={zone.fanMode === fan}
                  onClick={() => onSetFan(zone.entityId, fan)}
                >
                  {cap(fan)}
                </Chip>
              ))}
            </div>
          ) : (
            <span style={{ fontSize: 13, color: "var(--ink-3)" }}>No fan modes available</span>
          )}
        </section>

        {/* Divider before the house-wide summary. */}
        <div className="divider" />

        {/* Section 3 , Active now. All zones listed with a StatusDot showing
            whether they are actively conditioning. A live count badge up top
            surfaces at a glance how many zones are running without needing to
            scan the list. Gap 13 between rows keeps the list compact. */}
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span className="cap">Active now</span>
            <span className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>
              {zones.filter((z) => isActive(z.hvacAction)).length}/{zones.length} zones
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
            {zones.map((z) => (
              <div
                key={z.entityId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 14px",
                  borderRadius: 13,
                  background: "var(--nest)",
                  border: "1px solid var(--hair)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <StatusDot online={isActive(z.hvacAction)} />
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{z.label}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {/* Action label (Cooling / Heating / Idle / Off) */}
                  <span
                    style={{
                      fontSize: 12,
                      color: isActive(z.hvacAction) ? "var(--acc)" : "var(--ink-3)",
                    }}
                  >
                    {actionLabel(z.hvacAction)}
                  </span>
                  {/* Active preset as a compact chip-style badge */}
                  <span className="pill" style={{ fontSize: 11.5, padding: "3px 9px" }}>
                    {cap(z.presetMode)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
