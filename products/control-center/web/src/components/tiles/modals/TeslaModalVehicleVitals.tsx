/**
 * TeslaModalVehicleVitals , the "act on the car" surface for the Tesla tile.
 *
 * WHY this layout: the tile shows a map + charge summary but has no action
 * surface , you can't lock/unlock or precondition the cabin from the board.
 * This modal fills that gap: a dense control-and-status board that surfaces
 * every entity at once (lock, climate, battery, range, odometer, charge state,
 * current location) and adds two ControlTap actions (Lock/Unlock, Precondition).
 *
 * Layout (width 640, maxHeight 680):
 *   - Top row: lock state pill + place name pill (where the car is right now)
 *   - 2×2 StatCell grid (Battery, Range, Cabin, Odometer); the Battery cell
 *     carries a BorderProgressRing so the charge level is visual at a glance.
 *   - Bottom: two ControlTap actions side-by-side (Lock/Unlock, Precondition).
 *
 * Spacing: sections gap 24, inner grids/rows gap 13, label+control gap 10 ,
 * mirrors the Controls modal rhythm exactly so the two surfaces feel like one
 * design system.
 *
 * PURE view: all data + callbacks arrive via props. No trpc/hooks.
 */

import { Icon } from "@/components/Icon";
import { BorderProgressRing, Modal, Pill, PillTone, Stat } from "@/components/ui";

// ─── types ────────────────────────────────────────────────────────────────────

/** Charging state enum from sensor.evee_charging. */
export type ChargingState =
  | "starting"
  | "charging"
  | "stopped"
  | "complete"
  | "disconnected"
  | "no_power";

export interface TeslaModalVehicleVitalsProps {
  open: boolean;
  onClose: () => void;
  /** Current lock state from lock.evee_lock. */
  locked: boolean;
  /** Whether a lock/unlock action is in flight. */
  lockPending: boolean;
  /** Cabin temperature in °F from sensor.evee_inside_temperature. */
  cabinTempF: number;
  /** Whether cabin preconditioning is active (climate is on). */
  preconditioning: boolean;
  /** Whether a precondition toggle is in flight. */
  preconditionPending: boolean;
  /** Battery level 0–100 from sensor.evee_battery_level. */
  batteryPct: number;
  /** Estimated range in miles from sensor.evee_battery_range. */
  rangeMiles: number;
  /** Odometer reading from sensor.evee_odometer. May be "," when car is asleep. */
  odometer: string;
  /** Charging state from sensor.evee_charging. */
  chargingState: ChargingState;
  /** Human-readable place name (nearest named place or HA zone name). */
  placeName: string;
  /** Fire lock or unlock. Caller decides which based on current locked state. */
  onToggleLock: () => void;
  /** Toggle cabin preconditioning on/off. */
  onTogglePrecondition: () => void;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

// Maps sensor.evee_charging enum to a display label and pill tone. The tile
// uses these same enums so the language is consistent across surfaces.
function chargingLabel(state: ChargingState): string {
  switch (state) {
    case "starting":
      return "Starting";
    case "charging":
      return "Charging";
    case "stopped":
      return "Stopped";
    case "complete":
      return "Complete";
    case "disconnected":
      return "Unplugged";
    case "no_power":
      return "No Power";
  }
}

function chargingTone(state: ChargingState): PillTone {
  // Green = actively charging or just completed; amber = anomaly; default = idle.
  if (state === "charging" || state === "complete") return PillTone.On;
  if (state === "no_power") return PillTone.Amber;
  return PillTone.Default;
}

// ─── view ─────────────────────────────────────────────────────────────────────

export function TeslaModalVehicleVitals({
  open,
  onClose,
  locked,
  lockPending,
  cabinTempF,
  preconditioning,
  preconditionPending,
  batteryPct,
  rangeMiles,
  odometer,
  chargingState,
  placeName,
  onToggleLock,
  onTogglePrecondition,
}: TeslaModalVehicleVitalsProps) {
  return (
    <Modal open={open} onClose={onClose} title="Tesla" width={640} maxHeight={680}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* ── Status pills ── lock state + current location at a glance.
            Two pills on one row; gap 10 matches label+control rhythm. */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Pill tone={locked ? PillTone.Default : PillTone.Amber}>
            {/* Lock/Unlock icon inline , no separate Icon import needed for these tiny pills. */}
            <span aria-hidden="true" style={{ fontSize: 11 }}>
              {locked ? "🔒" : "🔓"}
            </span>
            {locked ? "Locked" : "Unlocked"}
          </Pill>
          <Pill tone={PillTone.Default}>
            <span aria-hidden="true" style={{ fontSize: 11 }}>
              📍
            </span>
            {placeName}
          </Pill>
          {/* Charging state pill , only rendered when not fully disconnected/stopped
              so the row stays uncluttered at rest. */}
          <Pill tone={chargingTone(chargingState)}>{chargingLabel(chargingState)}</Pill>
        </div>

        {/* ── 2×2 StatCell grid ── Battery, Range, Cabin, Odometer.
            gap 13 within grid matches Controls modal inner grid rhythm.
            Battery cell is position:relative so the BorderProgressRing can
            overlay its perimeter as a visual charge indicator. */}
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="cap">Vitals</span>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 13,
            }}
          >
            {/* Battery , ring overlays the tile border to visualise charge level. */}
            <div
              style={{
                position: "relative",
                background: "var(--nest)",
                border: "1px solid var(--hair)",
                borderRadius: 15,
                padding: "18px 18px 14px",
              }}
            >
              <BorderProgressRing
                progress={batteryPct / 100}
                color={batteryPct > 20 ? "var(--acc)" : "var(--amber)"}
                trackColor="var(--hair-2)"
                transitionMs={600}
                data-testid="battery-ring"
              />
              <Stat
                label="Battery"
                value={`${batteryPct}%`}
                accent={batteryPct > 20}
                muted={batteryPct <= 20}
              />
            </div>

            {/* Range */}
            <div
              style={{
                background: "var(--nest)",
                border: "1px solid var(--hair)",
                borderRadius: 15,
                padding: "18px 18px 14px",
              }}
            >
              <Stat label="Range" value={`${rangeMiles} mi`} />
            </div>

            {/* Cabin temperature */}
            <div
              style={{
                background: "var(--nest)",
                border: "1px solid var(--hair)",
                borderRadius: 15,
                padding: "18px 18px 14px",
              }}
            >
              <Stat label="Cabin" value={`${cabinTempF}°F`} accent={preconditioning} />
            </div>

            {/* Odometer , may be "," when car is asleep/disabled */}
            <div
              style={{
                background: "var(--nest)",
                border: "1px solid var(--hair)",
                borderRadius: 15,
                padding: "18px 18px 14px",
              }}
            >
              <Stat label="Odometer" value={odometer} muted={odometer === ","} />
            </div>
          </div>
        </section>

        {/* ── Action controls ── Lock/Unlock + Precondition side by side.
            Two ControlTap tiles at fixed height; gap 13 matches stat grid. */}
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="cap">Actions</span>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 13,
              height: 100,
            }}
          >
            {/* Lock/Unlock , icon and label flip with current state so the button
                always describes the ACTION you're about to take, not what is. */}
            <button
              type="button"
              aria-pressed={locked}
              aria-label={locked ? "Unlock" : "Lock"}
              className={`tap${locked ? " on" : ""}`}
              onClick={onToggleLock}
              data-pending={lockPending ? "true" : undefined}
              style={{
                padding: "17px 17px 12px",
                width: "100%",
                height: "100%",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                cursor: "pointer",
                textAlign: "left",
                font: "inherit",
                color: "inherit",
                background: "none",
                opacity: lockPending ? 0.7 : 1,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                }}
              >
                <Icon
                  name={locked ? "lock" : "unlock"}
                  s={26}
                  c={locked ? "var(--acc)" : "var(--ink-2)"}
                />
                <span className="sd" />
              </div>
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}
              >
                <span style={{ fontSize: 18, fontWeight: 500 }}>{locked ? "Unlock" : "Lock"}</span>
                <span
                  className="mono"
                  style={{
                    fontSize: 12,
                    color: locked ? "var(--acc)" : "var(--ink-3)",
                    textTransform: "uppercase",
                    letterSpacing: ".08em",
                  }}
                >
                  {locked ? "Locked" : "Unlocked"}
                </span>
              </div>
            </button>

            {/* Precondition , fires climate.turn_on / turn_off via ha.callService.
                "on" style shows when the cabin is actively being conditioned. */}
            <button
              type="button"
              aria-pressed={preconditioning}
              aria-label="Precondition"
              className={`tap${preconditioning ? " on" : ""}`}
              onClick={onTogglePrecondition}
              data-pending={preconditionPending ? "true" : undefined}
              style={{
                padding: "17px 17px 12px",
                width: "100%",
                height: "100%",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                cursor: "pointer",
                textAlign: "left",
                font: "inherit",
                color: "inherit",
                background: "none",
                opacity: preconditionPending ? 0.7 : 1,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                }}
              >
                <Icon name="thermo" s={26} c={preconditioning ? "var(--acc)" : "var(--ink-2)"} />
                <span className="sd" />
              </div>
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}
              >
                <span style={{ fontSize: 18, fontWeight: 500 }}>Precondition</span>
                <span
                  className="mono"
                  style={{
                    fontSize: 12,
                    color: preconditioning ? "var(--acc)" : "var(--ink-3)",
                    textTransform: "uppercase",
                    letterSpacing: ".08em",
                  }}
                >
                  {preconditioning ? "Active" : "Off"}
                </span>
              </div>
            </button>
          </div>
        </section>
      </div>
    </Modal>
  );
}
