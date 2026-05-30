/**
 * ClimateTileView — pure presentational component for the Climate tile.
 * All data and callbacks come in as props; no trpc or data-fetching hooks inside.
 *
 * Local state (slider drag position) is allowed here because it is purely a
 * presentation concern — the container drives the committed value via onSetTarget.
 */

import { useState } from "react";
import { Skeleton, Tile, TileHeader } from "../ui";

// ─── types ────────────────────────────────────────────────────────────────────

// Design constants (evee-tiles.jsx EClimate)
const MIN = 65;
const MAX = 80;

export type ClimateMode = "cool" | "auto" | "heat";

export type ClimateTileViewProps =
  | { status: "loading" }
  | {
      status: "populated";
      /** Committed setpoint from the container (may include optimistic value). */
      target: number;
      /** Current ambient temperature. */
      ambient: number;
      /** Committed mode (from server or optimistic override). */
      mode: ClimateMode;
      /** Live action string from HA (e.g. "Cooling", "Heating", "Idle"). */
      action: string;
      /** Called when the slider is released / committed by the container logic. */
      onSetTarget: (target: number) => void;
      /** Called when a mode chip is clicked with (mode, presetTarget). */
      onSetMode: (mode: ClimateMode, presetTarget: number) => void;
    };

// ─── ClimateSkeleton ──────────────────────────────────────────────────────────

function ClimateSkeleton() {
  return (
    <Tile padding={22}>
      <Skeleton w="60%" h={20} borderRadius={6} />
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Skeleton w={120} h={92} borderRadius={12} />
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 22 }}>
        <Skeleton w="33%" h={32} borderRadius={8} />
        <Skeleton w="33%" h={32} borderRadius={8} />
        <Skeleton w="33%" h={32} borderRadius={8} />
      </div>
      <Skeleton w="100%" h={20} borderRadius={6} />
    </Tile>
  );
}

// ─── ClimateTileView ──────────────────────────────────────────────────────────

export function ClimateTileView(props: ClimateTileViewProps) {
  // Slider drag tracks a local display value while the thumb is moving.
  // The container owns the debounce/cooldown; we just call onSetTarget on change.
  // Must be declared before the early-return so hook order is always consistent.
  const [dragTarget, setDragTarget] = useState<number | null>(null);

  if (props.status === "loading") return <ClimateSkeleton />;

  const { target, ambient, mode, action, onSetTarget, onSetMode } = props;

  const displayTarget = dragTarget ?? target;

  const pct = ((displayTarget - MIN) / (MAX - MIN)) * 100;
  const ambPct = ((ambient - MIN) / (MAX - MIN)) * 100;

  const chips: [ClimateMode, string, number][] = [
    ["cool", "Cool", 68],
    ["auto", "Auto", 72],
    ["heat", "Heat", 76],
  ];

  return (
    <Tile padding={22}>
      {/* Header */}
      <TileHeader
        icon="thermo"
        title="Climate · A/C"
        right={
          <span className="pill on" style={{ padding: "4px 10px" }} data-testid="mode-pill">
            {action}
          </span>
        }
      />

      {/* Big setpoint */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          className="mono"
          style={{ fontSize: 92, fontWeight: 700, lineHeight: 0.9, letterSpacing: "-0.04em" }}
          data-testid="setpoint"
        >
          {displayTarget}
          <span style={{ fontSize: 30, color: "var(--ink-2)" }}>°F</span>
        </div>
      </div>

      {/* Mode chips */}
      <div style={{ display: "flex", gap: 8, marginBottom: 22 }}>
        {chips.map(([k, label, presetVal]) => (
          <button
            key={k}
            type="button"
            className={`chip${mode === k ? " on" : ""}`}
            onClick={() => onSetMode(k, presetVal)}
            aria-pressed={mode === k}
            data-testid={`chip-${k}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Slider + ambient "Now" caret */}
      <div style={{ position: "relative", paddingBottom: 28 }}>
        <input
          className="range"
          type="range"
          min={MIN}
          max={MAX}
          value={displayTarget}
          style={{ "--p": `${pct}%` } as React.CSSProperties}
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
        {/* Ambient caret marker */}
        <div
          style={{
            position: "absolute",
            left: `${ambPct}%`,
            top: -3,
            transform: "translateX(-50%)",
            pointerEvents: "none",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <div
            style={{
              width: 2,
              height: 22,
              background: "rgba(255,255,255,.65)",
              borderRadius: 1,
            }}
          />
          <span
            className="mono"
            style={{ fontSize: 11, color: "var(--ink-2)", whiteSpace: "nowrap", marginTop: 3 }}
            data-testid="ambient-label"
          >
            {Math.round(ambient)}°
          </span>
        </div>
        {/* Range end labels */}
        <span
          className="mono"
          style={{ position: "absolute", left: 0, bottom: 0, fontSize: 12, color: "var(--ink-3)" }}
        >
          65°
        </span>
        <span
          className="mono"
          style={{ position: "absolute", right: 0, bottom: 0, fontSize: 12, color: "var(--ink-3)" }}
        >
          80°
        </span>
      </div>
    </Tile>
  );
}
