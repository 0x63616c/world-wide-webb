/**
 * ClimateTileView — pure presentational component for the Climate tile.
 * All data and callbacks come in as props; no trpc or data-fetching hooks inside.
 *
 * Modes are REAL Home Assistant hvac modes (off/cool/heat/heat_cool), not derived
 * from the setpoint:
 *  - off       → no setpoint control, big "Off"
 *  - cool/heat → single slider (one setpoint)
 *  - heat_cool → dual-thumb single track (low + high, min 2°F apart, never cross)
 *
 * Local state (slider drag) is allowed here because it is purely a presentation
 * concern — the container owns the committed value via the onSet* callbacks.
 */

import { useState } from "react";
import { Skeleton, Tile, TileHeader, TileStatus } from "@/components/ui";

// ─── types & constants ──────────────────────────────────────────────────────

// Visual band (matches the API's accept range, www-pu4m).
export const MIN = 67;
export const MAX = 77;
// Minimum deadband between low/high in heat_cool — thumbs can never meet/cross.
export const GAP = 2;

export const HvacMode = {
  Off: "off",
  Cool: "cool",
  Heat: "heat",
  HeatCool: "heat_cool",
} as const;
export type HvacMode = (typeof HvacMode)[keyof typeof HvacMode];

export type ClimateMode = HvacMode;

// Order is fixed and load-bearing: the button row is always the tile's bottom
// row, so its contents must never reflow. Cool · Heat · Heat·Cool · Off.
const HvacModeEntries: [HvacMode, string][] = [
  [HvacMode.Cool, "Cool"],
  [HvacMode.Heat, "Heat"],
  [HvacMode.HeatCool, "Heat·Cool"],
  [HvacMode.Off, "Off"],
];

type PopulatedBase = {
  status: typeof TileStatus.Populated;
  /** Current ambient temperature. */
  ambient: number;
  /** Live action string from HA (e.g. "Cooling", "Heating", "Idle"). */
  action: string;
  /** Called when a mode button is clicked. */
  onSetMode: (mode: ClimateMode) => void;
  /** Called when the single (cool/heat) setpoint changes. */
  onSetTarget: (target: number) => void;
  /** Called when the heat_cool range changes (already clamped, low < high). */
  onSetRange: (low: number, high: number) => void;
};

// Discriminated union on mode mirrors the API: a single `target` and a
// `targetLow`/`targetHigh` range can never be passed together.
export type ClimateTileViewProps =
  | { status: typeof TileStatus.Loading }
  | (PopulatedBase & { mode: typeof HvacMode.Off })
  | (PopulatedBase & { mode: typeof HvacMode.Cool | typeof HvacMode.Heat; target: number })
  | (PopulatedBase & { mode: typeof HvacMode.HeatCool; targetLow: number; targetHigh: number });

// ─── pure clamp helpers (unit-tested) ─────────────────────────────────────────

/** Clamp a proposed low setpoint into [MIN, high - GAP] so it can't reach high. */
export function clampLow(next: number, high: number): number {
  return Math.min(Math.max(next, MIN), high - GAP);
}

/** Clamp a proposed high setpoint into [low + GAP, MAX] so it can't reach low. */
export function clampHigh(next: number, low: number): number {
  return Math.max(Math.min(next, MAX), low + GAP);
}

const pct = (v: number) => ((v - MIN) / (MAX - MIN)) * 100;

// ─── ClimateSkeleton ──────────────────────────────────────────────────────────

function ClimateSkeleton() {
  return (
    <Tile padding={22}>
      {/* Title stays visible while loading; the action pill (data-driven) shimmers. */}
      <TileHeader
        icon="thermo"
        title="Climate · A/C"
        right={<Skeleton w={70} h={25} borderRadius={999} />}
      />
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Skeleton w={120} h={92} borderRadius={12} />
      </div>
      <Skeleton w="100%" h={20} borderRadius={6} />
      <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
        <Skeleton w="25%" h={32} borderRadius={8} />
        <Skeleton w="25%" h={32} borderRadius={8} />
        <Skeleton w="25%" h={32} borderRadius={8} />
        <Skeleton w="25%" h={32} borderRadius={8} />
      </div>
    </Tile>
  );
}

// ─── ambient "Now" caret + end labels ─────────────────────────────────────────

function AmbientCaret({ ambient }: { ambient: number }) {
  return (
    <div
      style={{
        position: "absolute",
        left: `${pct(ambient)}%`,
        top: -3,
        transform: "translateX(-50%)",
        pointerEvents: "none",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <div style={{ width: 2, height: 22, background: "rgba(255,255,255,.65)", borderRadius: 1 }} />
      <span
        className="mono"
        style={{ fontSize: 11, color: "var(--ink-2)", whiteSpace: "nowrap", marginTop: 3 }}
        data-testid="ambient-label"
      >
        {Math.round(ambient)}°
      </span>
    </div>
  );
}

function EndLabels() {
  return (
    <>
      <span
        className="mono"
        style={{ position: "absolute", left: 0, bottom: 0, fontSize: 12, color: "var(--ink-3)" }}
      >
        {MIN}°
      </span>
      <span
        className="mono"
        style={{ position: "absolute", right: 0, bottom: 0, fontSize: 12, color: "var(--ink-3)" }}
      >
        {MAX}°
      </span>
    </>
  );
}

// ─── ClimateTileView ──────────────────────────────────────────────────────────

export function ClimateTileView(props: ClimateTileViewProps) {
  // Drag state for the single + dual sliders. Declared before the early-return so
  // hook order is always consistent.
  const [dragTarget, setDragTarget] = useState<number | null>(null);
  const [dragLow, setDragLow] = useState<number | null>(null);
  const [dragHigh, setDragHigh] = useState<number | null>(null);

  if (props.status === TileStatus.Loading) return <ClimateSkeleton />;

  const { mode, ambient, action, onSetMode, onSetTarget, onSetRange } = props;

  return (
    <Tile padding={22}>
      <TileHeader
        icon="thermo"
        title="Climate · A/C"
        right={
          <span className="pill on" style={{ padding: "4px 10px" }} data-testid="mode-pill">
            {action}
          </span>
        }
      />

      {/* Big setpoint area — shape depends on mode */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {mode === HvacMode.Off && (
          <div
            style={{
              fontSize: 52,
              fontWeight: 700,
              color: "var(--ink-3)",
              letterSpacing: "-0.02em",
            }}
            data-testid="setpoint"
          >
            Off
          </div>
        )}

        {(mode === HvacMode.Cool || mode === HvacMode.Heat) && (
          <div
            className="mono"
            style={{ fontSize: 92, fontWeight: 700, lineHeight: 0.9, letterSpacing: "-0.04em" }}
            data-testid="setpoint"
          >
            {dragTarget ?? props.target}
            <span style={{ fontSize: 30, color: "var(--ink-2)" }}>°F</span>
          </div>
        )}

        {mode === HvacMode.HeatCool && (
          <div
            className="mono"
            style={{ fontSize: 52, fontWeight: 700, lineHeight: 0.9, letterSpacing: "-0.03em" }}
            data-testid="setpoint"
          >
            {dragLow ?? props.targetLow}
            <span style={{ fontSize: 22, color: "var(--ink-3)", padding: "0 8px" }}>–</span>
            {dragHigh ?? props.targetHigh}
            <span style={{ fontSize: 22, color: "var(--ink-2)" }}>°F</span>
          </div>
        )}
      </div>

      {/* Slider area — single, dual, or none (off). Rendered ABOVE the button row
          so the buttons never reflow: the draggable control appears in the gap
          between the big setpoint and the fixed bottom button row. */}
      {(mode === HvacMode.Cool || mode === HvacMode.Heat) &&
        (() => {
          const displayTarget = dragTarget ?? props.target;
          return (
            <div style={{ position: "relative", paddingBottom: 28, marginBottom: 18 }}>
              <input
                className="range"
                type="range"
                min={MIN}
                max={MAX}
                value={displayTarget}
                style={{ "--p": `${pct(displayTarget)}%` } as React.CSSProperties}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setDragTarget(val);
                  onSetTarget(val);
                }}
                onMouseUp={() => setDragTarget(null)}
                onTouchEnd={() => setDragTarget(null)}
                aria-label="Target temperature"
                data-testid="slider"
              />
              <AmbientCaret ambient={ambient} />
              <EndLabels />
            </div>
          );
        })()}

      {mode === HvacMode.HeatCool &&
        (() => {
          const lo = dragLow ?? props.targetLow;
          const hi = dragHigh ?? props.targetHigh;
          return (
            <div
              className="range-dual"
              style={{ position: "relative", paddingBottom: 28, marginBottom: 18 }}
            >
              <div
                className="range-dual-track"
                style={{ "--lo": `${pct(lo)}%`, "--hi": `${pct(hi)}%` } as React.CSSProperties}
              />
              <input
                className="range-thumb"
                type="range"
                min={MIN}
                max={MAX}
                value={lo}
                onChange={(e) => {
                  const val = clampLow(parseInt(e.target.value, 10), hi);
                  setDragLow(val);
                  onSetRange(val, hi);
                }}
                onMouseUp={() => setDragLow(null)}
                onTouchEnd={() => setDragLow(null)}
                aria-label="Low temperature"
                data-testid="slider-low"
              />
              <input
                className="range-thumb"
                type="range"
                min={MIN}
                max={MAX}
                value={hi}
                onChange={(e) => {
                  const val = clampHigh(parseInt(e.target.value, 10), lo);
                  setDragHigh(val);
                  onSetRange(lo, val);
                }}
                onMouseUp={() => setDragHigh(null)}
                onTouchEnd={() => setDragHigh(null)}
                aria-label="High temperature"
                data-testid="slider-high"
              />
              <AmbientCaret ambient={ambient} />
              <EndLabels />
            </div>
          );
        })()}

      {/* Mode buttons — ALWAYS the tile's bottom row. Fixed order, never reflows.
          marginBottom 0: the Tile's 22px padding gives even bottom spacing. */}
      <div style={{ display: "flex", gap: 8, marginBottom: 0 }}>
        {HvacModeEntries.map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={`chip${mode === k ? " on" : ""}`}
            onClick={() => onSetMode(k)}
            aria-pressed={mode === k}
            data-testid={`chip-${k}`}
          >
            {label}
          </button>
        ))}
      </div>
    </Tile>
  );
}
