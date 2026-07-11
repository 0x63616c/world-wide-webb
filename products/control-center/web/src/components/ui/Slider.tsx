/**
 * Slider , standalone dumb presentational range control with a label + value
 * readout. Zero trpc/data/hook dependencies; all state driven by props.
 *
 * Wraps the shared `.range` class (see styles/tokens.css) , the same dark-track +
 * accent-fill rail every other slider in the app uses (lamp brightness, climate,
 * party speed, mixer). The fill is driven by the `--p` custom property; we keep
 * only the label + value readout on top so the control reads consistently.
 */

import type { CSSProperties } from "react";

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (next: number) => void;
  /** Label shown to the left of the value; also the accessible name. */
  label: string;
  /** Format the value readout (e.g. `${n} min`, `${n}%`). Defaults to String. */
  format?: (value: number) => string;
  disabled?: boolean;
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
  format = String,
  disabled,
}: SliderProps) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, opacity: disabled ? 0.4 : 1 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          fontFamily: "var(--ui)",
        }}
      >
        <span style={{ fontSize: 14, color: "var(--ink-2)" }}>{label}</span>
        <span
          className="mono"
          style={{
            fontFamily: "var(--mono)",
            fontSize: 13,
            color: "var(--ink)",
            letterSpacing: "-0.02em",
          }}
        >
          {format(value)}
        </span>
      </div>
      <input
        className="range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        // --p drives the .range fill gradient (accent up to the value, dark rail
        // after). cursor:default when disabled overrides the class's pointer.
        style={{ "--p": `${pct}%`, cursor: disabled ? "default" : "pointer" } as CSSProperties}
      />
    </div>
  );
}
