/**
 * ClimateModalMultiZoneGrid — "Multi-Zone Control" expanded modal for the Climate tile.
 *
 * WHY this layout: the tile is hardwired to ONE selected thermostat (climate.home
 * via selectClimateEntity). This modal surfaces ALL house climate entities
 * (climate.ac, climate.bedroom, climate.home, climate.living_room) in a 2-col
 * card grid, giving the user per-zone control — a capability the tile structurally
 * cannot offer, not just a magnified single thermostat.
 *
 * Header row: house-average ambient stat + a summary of how many zones are actively
 * cooling/heating so the whole-house state is legible at a glance before diving in.
 *
 * Card layout per zone: zone name header, big ambient + setpoint stats side-by-side,
 * a mode chip row showing only the hvac_modes that entity advertises, then a
 * single-or-dual slider matching the tile's existing single/heat_cool logic.
 * Cards use the .tile surface (--tile) so they nest visually inside the --tile
 * panel background rather than blending with it.
 *
 * PURE view: all data + callbacks arrive via props. No trpc/hooks. Composes
 * trivially in Storybook and tests. Width 720, maxHeight 820 (4 cards × ~180px +
 * header/gaps fits without scrolling at typical data sizes; body scrolls if needed).
 *
 * Spacing follows the Controls modal rhythm:
 *   gap 24 between sections (header → grid)
 *   gap 13 between cards in the grid
 *   gap 10 between label and control inside a card
 */

import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { Chip, Modal, Stat } from "../../ui";

// ─── types ────────────────────────────────────────────────────────────────────

// Per-entity hvac modes — matches the HA attribute. Only the modes the zone
// advertises are rendered as chips so the user can't send an unsupported mode.
export type HvacMode = "off" | "cool" | "heat" | "heat_cool" | "fan_only" | "dry" | "auto";

// Action as it arrives from HA (lowercase) — normalised for display in the card.
export type HvacAction = "cooling" | "heating" | "idle" | "off";

// The slider shape mirrors ClimateTileView: discriminated on mode so a single
// target and a range can never coexist.
type ZoneSetpoint =
  | { mode: "off" }
  | { mode: "cool" | "heat" | "fan_only" | "dry" | "auto"; target: number }
  | { mode: "heat_cool"; targetLow: number; targetHigh: number };

export type ZoneData = ZoneSetpoint & {
  entityId: string;
  /** Display name derived from the entity (e.g. "A/C", "Bedroom"). */
  name: string;
  /** Current ambient temperature from HA current_temperature attribute. */
  ambient: number;
  /** Live hvac_action from HA (cooling/heating/idle/off). */
  action: HvacAction;
  /** Advertised modes for this zone — drives chip rendering. */
  supportedModes: HvacMode[];
  /** HA min_temp attribute for this entity's slider bound. */
  minTemp: number;
  /** HA max_temp attribute for this entity's slider bound. */
  maxTemp: number;
};

export interface ClimateModalMultiZoneGridProps {
  open: boolean;
  onClose: () => void;
  /** All house climate zones from ha.getEntities('climate') (excl. Tesla). */
  zones: ZoneData[];
  /**
   * Called when the user picks a new mode for a zone.
   * Wires to setClimateMode(entityId, mode) — the container handles the mutation.
   */
  onSetMode: (entityId: string, mode: HvacMode) => void;
  /**
   * Called when the user drags the single setpoint slider.
   * Wires to setClimateTarget(entityId, target).
   */
  onSetTarget: (entityId: string, target: number) => void;
  /**
   * Called when the user drags either dual-thumb (heat_cool) slider.
   * Wires to setClimateRange(entityId, low, high).
   */
  onSetRange: (entityId: string, low: number, high: number) => void;
}

// ─── constants ────────────────────────────────────────────────────────────────

// Minimum deadband in heat_cool — mirrors CLIMATE_GAP from the service.
const GAP = 2;

// Mode labels in display order — zones show only their own supportedModes subset.
const MODE_LABELS: Record<HvacMode, string> = {
  off: "Off",
  cool: "Cool",
  heat: "Heat",
  heat_cool: "Heat·Cool",
  fan_only: "Fan",
  dry: "Dry",
  auto: "Auto",
};

// Display-friendly action labels — normalised from HA's lowercase strings.
const ACTION_LABELS: Record<HvacAction, string> = {
  cooling: "Cooling",
  heating: "Heating",
  idle: "Idle",
  off: "Off",
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function pct(v: number, min: number, max: number): number {
  return ((v - min) / (max - min)) * 100;
}

function clampLow(next: number, high: number, min: number): number {
  return Math.min(Math.max(next, min), high - GAP);
}

function clampHigh(next: number, low: number, max: number): number {
  return Math.max(Math.min(next, max), low + GAP);
}

// ─── ZoneCard ─────────────────────────────────────────────────────────────────

// Each zone gets its own card. Slider drag state lives here so cards are
// independent — dragging bedroom doesn't flash the living-room readout.
function ZoneCard({
  zone,
  onSetMode,
  onSetTarget,
  onSetRange,
}: {
  zone: ZoneData;
  onSetMode: (entityId: string, mode: HvacMode) => void;
  onSetTarget: (entityId: string, target: number) => void;
  onSetRange: (entityId: string, low: number, high: number) => void;
}) {
  // Local drag state per slider — seeded from props, resynced on upstream change.
  const [dragTarget, setDragTarget] = useState<number | null>(null);
  const [dragLow, setDragLow] = useState<number | null>(null);
  const [dragHigh, setDragHigh] = useState<number | null>(null);

  // Debounce for the single-setpoint slider — mirrors ExpandedControlsModalView's
  // 400ms brightness debounce so dragging fires ONE mutation for the settled value.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Resync slider drag state when the zone's committed value changes (e.g. after
  // a mutation round-trip) so the slider tracks the new source of truth.
  // biome-ignore lint/correctness/useExhaustiveDependencies: setState setters are stable; zone is the intended trigger
  useEffect(() => {
    setDragTarget(null);
    setDragLow(null);
    setDragHigh(null);
  }, [zone]);

  const isActive = zone.action === "cooling" || zone.action === "heating";

  return (
    <div
      style={{
        background: "var(--nest)",
        border: `1px solid ${isActive ? "var(--acc-line)" : "var(--hair)"}`,
        borderRadius: 15,
        padding: "16px 16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {/* Zone name + live action pill */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "var(--ink)",
            letterSpacing: "-0.01em",
          }}
        >
          {zone.name}
        </span>
        <span
          className={`pill${isActive ? " on" : ""}`}
          style={{ fontSize: 11, padding: "3px 9px" }}
        >
          {ACTION_LABELS[zone.action]}
        </span>
      </div>

      {/* Ambient + setpoint stats */}
      <div style={{ display: "flex", gap: 20 }}>
        <Stat label="Now" value={`${Math.round(zone.ambient)}°`} muted={!isActive} />
        {(zone.mode === "cool" ||
          zone.mode === "heat" ||
          zone.mode === "fan_only" ||
          zone.mode === "dry" ||
          zone.mode === "auto") && (
          <Stat label="Set" value={`${dragTarget ?? zone.target}°`} accent={isActive} />
        )}
        {zone.mode === "heat_cool" && (
          <Stat
            label="Range"
            value={`${dragLow ?? zone.targetLow}–${dragHigh ?? zone.targetHigh}°`}
            accent={isActive}
          />
        )}
        {zone.mode === "off" && <Stat label="Set" value="—" muted />}
      </div>

      {/* Mode chips — only modes this zone advertises */}
      <div style={{ display: "flex", gap: 6 }}>
        {zone.supportedModes.map((m) => (
          <Chip key={m} active={zone.mode === m} onClick={() => onSetMode(zone.entityId, m)}>
            {MODE_LABELS[m] ?? m}
          </Chip>
        ))}
      </div>

      {/* Slider — single or dual depending on mode; hidden when off */}
      {(zone.mode === "cool" ||
        zone.mode === "heat" ||
        zone.mode === "fan_only" ||
        zone.mode === "dry" ||
        zone.mode === "auto") &&
        (() => {
          const displayTarget = dragTarget ?? zone.target;
          const p = pct(displayTarget, zone.minTemp, zone.maxTemp);
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span className="cap">{zone.minTemp}°</span>
                <span className="cap">{zone.maxTemp}°</span>
              </div>
              <input
                className="range"
                type="range"
                min={zone.minTemp}
                max={zone.maxTemp}
                value={displayTarget}
                aria-label={`${zone.name} target temperature`}
                style={{ "--p": `${p}%` } as CSSProperties}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setDragTarget(val);
                  if (debounceRef.current) clearTimeout(debounceRef.current);
                  debounceRef.current = setTimeout(() => onSetTarget(zone.entityId, val), 400);
                }}
                onMouseUp={() => setDragTarget(null)}
                onTouchEnd={() => setDragTarget(null)}
              />
            </div>
          );
        })()}

      {zone.mode === "heat_cool" &&
        (() => {
          const lo = dragLow ?? zone.targetLow;
          const hi = dragHigh ?? zone.targetHigh;
          const loPct = pct(lo, zone.minTemp, zone.maxTemp);
          const hiPct = pct(hi, zone.minTemp, zone.maxTemp);
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span className="cap">{zone.minTemp}°</span>
                <span className="cap">{zone.maxTemp}°</span>
              </div>
              <div className="range-dual" style={{ position: "relative" }}>
                <div
                  className="range-dual-track"
                  style={{ "--lo": `${loPct}%`, "--hi": `${hiPct}%` } as CSSProperties}
                />
                <input
                  className="range-thumb"
                  type="range"
                  min={zone.minTemp}
                  max={zone.maxTemp}
                  value={lo}
                  aria-label={`${zone.name} low temperature`}
                  onChange={(e) => {
                    const val = clampLow(parseInt(e.target.value, 10), hi, zone.minTemp);
                    setDragLow(val);
                    onSetRange(zone.entityId, val, hi);
                  }}
                  onMouseUp={() => setDragLow(null)}
                  onTouchEnd={() => setDragLow(null)}
                />
                <input
                  className="range-thumb"
                  type="range"
                  min={zone.minTemp}
                  max={zone.maxTemp}
                  value={hi}
                  aria-label={`${zone.name} high temperature`}
                  onChange={(e) => {
                    const val = clampHigh(parseInt(e.target.value, 10), lo, zone.maxTemp);
                    setDragHigh(val);
                    onSetRange(zone.entityId, lo, val);
                  }}
                  onMouseUp={() => setDragHigh(null)}
                  onTouchEnd={() => setDragHigh(null)}
                />
              </div>
            </div>
          );
        })()}
    </div>
  );
}

// ─── view ─────────────────────────────────────────────────────────────────────

export function ClimateModalMultiZoneGrid({
  open,
  onClose,
  zones,
  onSetMode,
  onSetTarget,
  onSetRange,
}: ClimateModalMultiZoneGridProps) {
  // House-average ambient: mean of all zones' current_temperature values.
  // Meaningful even with mixed-mode zones — it's the whole-house sensor summary.
  const avgAmbient =
    zones.length > 0 ? zones.reduce((sum, z) => sum + z.ambient, 0) / zones.length : 0;

  const activeCooling = zones.filter((z) => z.action === "cooling").length;
  const activeHeating = zones.filter((z) => z.action === "heating").length;

  // Summarise what the house is doing right now in human terms.
  function houseSummary(): string {
    if (activeCooling > 0 && activeHeating > 0) {
      return `${activeCooling} cooling · ${activeHeating} heating`;
    }
    if (activeCooling > 0) {
      return activeCooling === zones.length
        ? "All zones cooling"
        : `${activeCooling} of ${zones.length} cooling`;
    }
    if (activeHeating > 0) {
      return activeHeating === zones.length
        ? "All zones heating"
        : `${activeHeating} of ${zones.length} heating`;
    }
    return "All zones idle";
  }

  return (
    <Modal open={open} onClose={onClose} title="Climate" width={720} maxHeight={820}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* House-average header — ambient avg + whole-house action summary.
            This gives a single-glance answer to "what's the house doing?" before
            the user digs into individual zones. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 24,
            padding: "14px 18px",
            borderRadius: 14,
            background: "var(--nest)",
            border: "1px solid var(--hair)",
          }}
        >
          <Stat
            label="House avg"
            value={`${Math.round(avgAmbient)}°F`}
            accent={activeCooling > 0 || activeHeating > 0}
          />
          <div className="divider" style={{ width: 1, height: 36, background: "var(--hair)" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span className="cap">Status</span>
            <span style={{ fontSize: 14, fontWeight: 500, color: "var(--ink-2)" }}>
              {houseSummary()}
            </span>
          </div>
        </div>

        {/* Per-zone card grid — 2 columns, gap 13 matches the Controls modal inner
            grid rhythm. 4 house zones → 2×2 natural layout; odd counts flow fine. */}
        {zones.length === 0 ? (
          // No zones returned — HA unavailable or no entities.
          <div
            style={{
              padding: "48px 0",
              textAlign: "center",
            }}
          >
            <span className="cap">No climate zones available</span>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 13,
            }}
          >
            {zones.map((zone) => (
              <ZoneCard
                key={zone.entityId}
                zone={zone}
                onSetMode={onSetMode}
                onSetTarget={onSetTarget}
                onSetRange={onSetRange}
              />
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
