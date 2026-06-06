/**
 * ClimateModalHouseThermalMap — spatial floorplan heat map of all climate zones.
 *
 * WHY this layout: the tile can only show one selected zone at a time, which
 * collapses the most useful insight — which rooms are hot right now vs which are
 * comfortable. A CSS-grid "floorplan" of zone cells, each tinted on a cold→warm
 * gradient from real current_temperature data, turns four numbers into an
 * instantly-readable distribution picture. Color is computed purely from
 * current_temperature interpolated against the per-zone min_temp/max_temp band
 * (real HA bounds). Selecting a cell slides a control strip in below the grid,
 * exposing mode chips and a target slider for that zone — the same controls as
 * the tile, but inline to the map so you stay oriented.
 *
 * Layout rhythm: 24px between sections, 13px cell gap, 10px label+control gap.
 * Matches the Controls modal scale exactly.
 *
 * PURE VIEW: all data + callbacks arrive via props. No trpc/hooks. Renders
 * correctly in Storybook and tests without a query provider.
 */

import type { CSSProperties } from "react";
import { useState } from "react";
import { Chip, Modal, StatusDot } from "@/components/ui";

// ─── types ────────────────────────────────────────────────────────────────────

/** HVAC action strings reported by Home Assistant. */
export type HvacAction = "cooling" | "heating" | "idle" | "off";

/** HVAC mode strings Home Assistant accepts. */
export type HvacMode = "off" | "cool" | "heat" | "heat_cool" | "auto" | "fan_only" | "dry";

/** All per-zone data that can come from ha.getEntities('climate'). */
export interface ClimateZone {
  /** HA entity id, e.g. "climate.bedroom" */
  entityId: string;
  /** Human-readable zone name, e.g. "Bedroom" */
  name: string;
  /** Ambient temperature measured by the zone sensor (°F). */
  currentTemperature: number;
  /** Active HVAC action — drives the status dot and action glyph. */
  hvacAction: HvacAction;
  /** Current mode — which chip is active in the inline control strip. */
  hvacMode: HvacMode;
  /** Modes the zone's unit supports — controls which chips render. */
  hvacModes: HvacMode[];
  /** Single setpoint when mode is cool/heat (°F). */
  targetTemperature: number | null;
  /** Heat-cool band low (°F). */
  targetTempLow: number | null;
  /** Heat-cool band high (°F). */
  targetTempHigh: number | null;
  /** HA min_temp for the zone (real hardware bound, not the visual 65-80 band). */
  minTemp: number;
  /** HA max_temp for the zone. */
  maxTemp: number;
}

export interface ClimateModalHouseThermalMapProps {
  open: boolean;
  onClose: () => void;
  /** All climate zones to display in the map. */
  zones: ClimateZone[];
  /** Called when the user picks a mode chip for a zone. */
  onSetMode: (entityId: string, mode: HvacMode) => void;
  /** Called when the user drags the setpoint slider for a zone (cool/heat). */
  onSetTarget: (entityId: string, temperature: number) => void;
  /** Called when the user adjusts the heat_cool range for a zone. */
  onSetRange: (entityId: string, low: number, high: number) => void;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Interpolate t in [a, b] → [0, 1], clamped. Used to position each zone on the
 * cold→warm gradient by its current_temperature relative to the zone's own
 * min_temp/max_temp band so the visual scale is grounded in real HA bounds.
 */
function lerp01(value: number, min: number, max: number): number {
  if (max <= min) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

/**
 * Map a normalised [0, 1] heat fraction to a CSS color. Cold side uses --acc
 * (the green accent, which reads as "cool" on this dark panel) transitioning
 * through a neutral mid to --amber (warm gold) at the hot end. Pure CSS custom
 * props can't be lerped, so we compute the channel mix here using the token
 * values directly: --acc #0070f3 (cool), neutral #9197a1 (mid), --amber #f4c063 (warm).
 */
function heatColor(fraction: number): string {
  // Two-segment gradient: [0, 0.5] cool→neutral, [0.5, 1] neutral→warm
  if (fraction <= 0.5) {
    const t = fraction / 0.5;
    const r = Math.round(0x5b + (0x91 - 0x5b) * t);
    const g = Math.round(0xe3 + (0x97 - 0xe3) * t);
    const b = Math.round(0x7d + (0xa1 - 0x7d) * t);
    return `rgb(${r},${g},${b})`;
  }
  const t = (fraction - 0.5) / 0.5;
  const r = Math.round(0x91 + (0xf4 - 0x91) * t);
  const g = Math.round(0x97 + (0xc0 - 0x97) * t);
  const b = Math.round(0xa1 + (0x63 - 0xa1) * t);
  return `rgb(${r},${g},${b})`;
}

/** Whether the HVAC action counts as "active" for the status dot. */
function isActive(action: HvacAction): boolean {
  return action === "cooling" || action === "heating";
}

/** Single-character action glyph for the zone cell overlay. */
function actionGlyph(action: HvacAction): string {
  if (action === "cooling") return "↓";
  if (action === "heating") return "↑";
  return "";
}

/** Human-readable mode label for the chip row. */
const MODE_LABELS: Partial<Record<HvacMode, string>> = {
  off: "Off",
  cool: "Cool",
  heat: "Heat",
  heat_cool: "Heat·Cool",
  auto: "Auto",
  fan_only: "Fan",
  dry: "Dry",
};

// ─── legend gradient ──────────────────────────────────────────────────────────

function LegendBar({ minLabel, maxLabel }: { minLabel: string; maxLabel: string }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <span className="cap">Temperature range</span>
      <div style={{ position: "relative" }}>
        <div
          aria-hidden="true"
          style={{
            height: 10,
            borderRadius: 999,
            // Gradient mirrors heatColor: acc (cool) → neutral → amber (warm)
            background: "linear-gradient(90deg, #0070f3, #9197a1 50%, #f4c063)",
          }}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 6,
          }}
        >
          <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
            {minLabel}
          </span>
          <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
            {maxLabel}
          </span>
        </div>
      </div>
    </section>
  );
}

// ─── zone cell ────────────────────────────────────────────────────────────────

function ZoneCell({
  zone,
  selected,
  onSelect,
}: {
  zone: ClimateZone;
  selected: boolean;
  onSelect: () => void;
}) {
  const fraction = lerp01(zone.currentTemperature, zone.minTemp, zone.maxTemp);
  const color = heatColor(fraction);
  const glyph = actionGlyph(zone.hvacAction);

  return (
    <button
      type="button"
      aria-label={`${zone.name} zone, ${Math.round(zone.currentTemperature)}°`}
      aria-pressed={selected}
      onClick={onSelect}
      style={{
        // Background tint at ~18% opacity so the zone colour reads against the
        // dark tile surface without washing it out.
        background: selected
          ? `color-mix(in srgb, ${color} 28%, var(--tile-2))`
          : `color-mix(in srgb, ${color} 14%, var(--nest))`,
        border: selected ? `1.5px solid ${color}` : "1px solid var(--hair)",
        borderRadius: 14,
        padding: "14px 16px",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        textAlign: "left",
        font: "inherit",
        color: "var(--ink)",
        transition: "background 0.18s, border-color 0.18s",
        position: "relative",
      }}
    >
      {/* Zone name + action glyph + status dot */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>{zone.name}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {glyph && (
            <span
              aria-hidden="true"
              style={{
                fontSize: 12,
                fontWeight: 700,
                color,
                lineHeight: 1,
              }}
            >
              {glyph}
            </span>
          )}
          <StatusDot online={isActive(zone.hvacAction)} />
        </div>
      </div>

      {/* Current temperature — large, tinted by heat color */}
      <div
        className="mono"
        style={{
          fontSize: 28,
          fontWeight: 700,
          lineHeight: 1,
          letterSpacing: "-0.03em",
          color,
        }}
      >
        {Math.round(zone.currentTemperature)}
        <span style={{ fontSize: 14, fontWeight: 500, color: "var(--ink-2)", marginLeft: 2 }}>
          °F
        </span>
      </div>

      {/* Setpoint line — shows target or band */}
      <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
        {zone.hvacMode === "off" && <span>Off</span>}
        {(zone.hvacMode === "cool" || zone.hvacMode === "heat") &&
          zone.targetTemperature !== null && (
            <span>
              Set{" "}
              <span className="mono" style={{ color: "var(--ink-2)" }}>
                {zone.targetTemperature}°
              </span>
            </span>
          )}
        {zone.hvacMode === "heat_cool" &&
          zone.targetTempLow !== null &&
          zone.targetTempHigh !== null && (
            <span>
              Band{" "}
              <span className="mono" style={{ color: "var(--ink-2)" }}>
                {zone.targetTempLow}–{zone.targetTempHigh}°
              </span>
            </span>
          )}
        {zone.hvacMode !== "off" &&
          zone.hvacMode !== "cool" &&
          zone.hvacMode !== "heat" &&
          zone.hvacMode !== "heat_cool" && (
            <span style={{ textTransform: "capitalize" }}>{zone.hvacMode}</span>
          )}
      </div>
    </button>
  );
}

// ─── inline control strip ─────────────────────────────────────────────────────

function ZoneControlStrip({
  zone,
  onSetMode,
  onSetTarget,
  onSetRange,
}: {
  zone: ClimateZone;
  onSetMode: (mode: HvacMode) => void;
  onSetTarget: (temperature: number) => void;
  onSetRange: (low: number, high: number) => void;
}) {
  // Local slider state for smooth drag — seeded from props, synced on change.
  const [dragTarget, setDragTarget] = useState<number | null>(null);
  const [dragLow, setDragLow] = useState<number | null>(null);
  const [dragHigh, setDragHigh] = useState<number | null>(null);

  const fraction = lerp01(zone.currentTemperature, zone.minTemp, zone.maxTemp);
  const color = heatColor(fraction);

  const showSingleSlider = zone.hvacMode === "cool" || zone.hvacMode === "heat";
  const showDualSlider = zone.hvacMode === "heat_cool";

  const effectiveTarget = dragTarget ?? zone.targetTemperature ?? zone.minTemp;
  const effectiveLow = dragLow ?? zone.targetTempLow ?? zone.minTemp;
  const effectiveHigh = dragHigh ?? zone.targetTempHigh ?? zone.maxTemp;
  const sliderPct = ((effectiveTarget - zone.minTemp) / (zone.maxTemp - zone.minTemp)) * 100;
  const lowPct = ((effectiveLow - zone.minTemp) / (zone.maxTemp - zone.minTemp)) * 100;
  const highPct = ((effectiveHigh - zone.minTemp) / (zone.maxTemp - zone.minTemp)) * 100;

  return (
    <section
      style={{
        background: `color-mix(in srgb, ${color} 8%, var(--nest))`,
        border: `1px solid color-mix(in srgb, ${color} 25%, var(--hair))`,
        borderRadius: 14,
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 13,
      }}
    >
      {/* Zone name header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="cap">{zone.name}</span>
        <span className="mono" style={{ fontSize: 12, color }}>
          {Math.round(zone.currentTemperature)}°F
        </span>
      </div>

      {/* Mode chips — only modes the zone actually supports */}
      <div style={{ display: "flex", gap: 8 }}>
        {zone.hvacModes.map((mode) => (
          <Chip key={mode} active={zone.hvacMode === mode} onClick={() => onSetMode(mode)}>
            {MODE_LABELS[mode] ?? mode}
          </Chip>
        ))}
      </div>

      {/* Single target slider (cool / heat) */}
      {showSingleSlider && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <span className="cap">Target</span>
            <span className="mono" style={{ fontSize: 13, color }}>
              {effectiveTarget}°F
            </span>
          </div>
          <input
            className="range"
            type="range"
            min={zone.minTemp}
            max={zone.maxTemp}
            value={effectiveTarget}
            aria-label={`${zone.name} target temperature`}
            onChange={(e) => {
              const val = Number(e.currentTarget.value);
              setDragTarget(val);
              onSetTarget(val);
            }}
            onMouseUp={() => setDragTarget(null)}
            onTouchEnd={() => setDragTarget(null)}
            // --p drives the .range fill gradient
            style={{ "--p": `${sliderPct}%` } as CSSProperties}
          />
        </div>
      )}

      {/* Dual-thumb range (heat_cool) */}
      {showDualSlider && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <span className="cap">Band</span>
            <span className="mono" style={{ fontSize: 13, color }}>
              {effectiveLow}–{effectiveHigh}°F
            </span>
          </div>
          <div className="range-dual" style={{ position: "relative" }}>
            <div
              className="range-dual-track"
              style={
                {
                  "--lo": `${lowPct}%`,
                  "--hi": `${highPct}%`,
                } as CSSProperties
              }
            />
            <input
              className="range-thumb"
              type="range"
              min={zone.minTemp}
              max={zone.maxTemp}
              value={effectiveLow}
              aria-label={`${zone.name} low temperature`}
              onChange={(e) => {
                const val = Math.min(Number(e.currentTarget.value), effectiveHigh - 2);
                setDragLow(val);
                onSetRange(val, effectiveHigh);
              }}
              onMouseUp={() => setDragLow(null)}
              onTouchEnd={() => setDragLow(null)}
            />
            <input
              className="range-thumb"
              type="range"
              min={zone.minTemp}
              max={zone.maxTemp}
              value={effectiveHigh}
              aria-label={`${zone.name} high temperature`}
              onChange={(e) => {
                const val = Math.max(Number(e.currentTarget.value), effectiveLow + 2);
                setDragHigh(val);
                onSetRange(effectiveLow, val);
              }}
              onMouseUp={() => setDragHigh(null)}
              onTouchEnd={() => setDragHigh(null)}
            />
          </div>
        </div>
      )}
    </section>
  );
}

// ─── main view ────────────────────────────────────────────────────────────────

export function ClimateModalHouseThermalMap({
  open,
  onClose,
  zones,
  onSetMode,
  onSetTarget,
  onSetRange,
}: ClimateModalHouseThermalMapProps) {
  // Which zone the user has tapped to expand its inline controls.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Derive the global temperature range for the legend: span across all zones'
  // min/max bounds so the legend ticks are grounded in real HA values.
  const allMins = zones.map((z) => z.minTemp);
  const allMaxes = zones.map((z) => z.maxTemp);
  const legendMin = allMins.length > 0 ? Math.min(...allMins) : 60;
  const legendMax = allMaxes.length > 0 ? Math.max(...allMaxes) : 90;

  const selectedZone = zones.find((z) => z.entityId === selectedId) ?? null;

  return (
    <Modal open={open} onClose={onClose} title="Climate" width={640} maxHeight={720}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Legend: gradient bar with real min/max ticks derived from zone bounds */}
        <LegendBar minLabel={`${legendMin}° cool`} maxLabel={`${legendMax}° warm`} />

        <div className="divider" />

        {/* Floorplan zone grid — CSS grid fills 600px, each cell tinted by temp.
            Two columns to mirror a rough floor layout. Cells are tappable to
            reveal the inline control strip below. */}
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="cap">Zones</span>
          {zones.length === 0 ? (
            <span style={{ fontSize: 14, color: "var(--ink-3)" }}>No climate zones available.</span>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 13,
              }}
            >
              {zones.map((zone) => (
                <ZoneCell
                  key={zone.entityId}
                  zone={zone}
                  selected={zone.entityId === selectedId}
                  onSelect={() =>
                    setSelectedId(zone.entityId === selectedId ? null : zone.entityId)
                  }
                />
              ))}
            </div>
          )}
        </section>

        {/* Inline control strip — slides in below the grid when a zone is selected.
            Rendered conditionally so the modal doesn't grow until needed. */}
        {selectedZone && (
          <ZoneControlStrip
            zone={selectedZone}
            onSetMode={(mode) => onSetMode(selectedZone.entityId, mode)}
            onSetTarget={(temperature) => onSetTarget(selectedZone.entityId, temperature)}
            onSetRange={(low, high) => onSetRange(selectedZone.entityId, low, high)}
          />
        )}
      </div>
    </Modal>
  );
}
