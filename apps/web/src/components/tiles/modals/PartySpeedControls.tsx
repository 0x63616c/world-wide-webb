/**
 * Party-speed widgets — the www-7d5b.3.7 speed spike, presentational only.
 *
 * Three competing affordances for choosing the party animation speed, built so
 * Calum can FEEL all three on real lamps and keep the winner. Every widget is
 * props-only (`value` + `onChange`) — zero trpc/hooks — so they drop straight
 * into ExpandedControlsModalView once setLampMode (www-7d5b.3.4) lands. The
 * wiring layer maps this frontend `PartySpeed` onto the backend speed enum.
 *
 * Speeds mirror the plan's LampModeSpeed (Slow/Medium/Fast). The labels here are
 * the canonical display strings the wiring + tests rely on.
 */

import type { CSSProperties } from "react";

// ─── speed model ───────────────────────────────────────────────────────────────

export const PartySpeed = {
  Slow: "slow",
  Medium: "medium",
  Fast: "fast",
} as const;
export type PartySpeed = (typeof PartySpeed)[keyof typeof PartySpeed];

// Ordered slow→fast — the array index doubles as the slider position and the
// cycle order. Single source of truth for order + display label.
export const PARTY_SPEEDS: { speed: PartySpeed; label: string }[] = [
  { speed: PartySpeed.Slow, label: "Slow" },
  { speed: PartySpeed.Medium, label: "Med" },
  { speed: PartySpeed.Fast, label: "Fast" },
];

const speedIndex = (s: PartySpeed) => PARTY_SPEEDS.findIndex((x) => x.speed === s);

interface SpeedWidgetProps {
  value: PartySpeed;
  onChange: (speed: PartySpeed) => void;
  /** Dimmed + non-interactive (party off / no lamps). */
  disabled?: boolean;
}

// ─── (a) segmented Slow / Med / Fast ────────────────────────────────────────────

/**
 * Segmented pill — three side-by-side options, the active one filled with --acc.
 * Same visual language as VariantSwitcher so it reads as a native control.
 */
export function PartySpeedSegmented({ value, onChange, disabled }: SpeedWidgetProps) {
  return (
    <div
      role="tablist"
      aria-label="Party speed"
      style={{
        display: "flex",
        gap: 4,
        padding: 5,
        borderRadius: 999,
        background: "var(--nest)",
        border: "1px solid var(--hair)",
        opacity: disabled ? 0.4 : 1,
        pointerEvents: disabled ? "none" : "auto",
      }}
    >
      {PARTY_SPEEDS.map(({ speed, label }) => {
        const active = speed === value;
        return (
          <button
            key={speed}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={label}
            onClick={() => onChange(speed)}
            style={{
              flex: 1,
              padding: "9px 0",
              borderRadius: 999,
              border: "none",
              cursor: "pointer",
              font: "inherit",
              fontSize: 14,
              fontWeight: 500,
              letterSpacing: ".02em",
              color: active ? "#ffffff" : "var(--ink-2)",
              background: active ? "var(--acc)" : "transparent",
              transition: "background .12s ease, color .12s ease",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ─── (b) speed slider ───────────────────────────────────────────────────────────

/**
 * Three-stop slider over the .range track. Snaps to the discrete speeds (no
 * in-between values — speed is categorical), with tick labels beneath. Reuses the
 * shared .range styling so the thumb/track match the brightness bar.
 */
export function PartySpeedSlider({ value, onChange, disabled }: SpeedWidgetProps) {
  const idx = speedIndex(value);
  const max = PARTY_SPEEDS.length - 1;
  // Fill the track up to the active stop (--p drives the .range gradient).
  const pct = max === 0 ? 0 : (idx / max) * 100;

  return (
    <div style={{ opacity: disabled ? 0.4 : 1 }}>
      <input
        className="range"
        type="range"
        min={0}
        max={max}
        step={1}
        value={idx}
        aria-label="Party speed"
        aria-valuetext={PARTY_SPEEDS[idx]?.label}
        disabled={disabled}
        onChange={(e) => {
          const next = PARTY_SPEEDS[Number(e.currentTarget.value)];
          if (next) onChange(next.speed);
        }}
        style={{ "--p": `${pct}%` } as CSSProperties}
      />
      {/* Tick labels aligned to the stops: first left, last right, middle centered. */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 8,
          fontSize: 12,
        }}
      >
        {PARTY_SPEEDS.map(({ speed, label }) => (
          <span
            key={speed}
            className="mono"
            style={{
              color: speed === value ? "var(--acc)" : "var(--ink-3)",
              textTransform: "uppercase",
              letterSpacing: ".06em",
            }}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── (c) tap-to-cycle ─────────────────────────────────────────────────────────

/**
 * Single tap target that cycles Slow → Med → Fast → Slow on each press, showing
 * the current speed and a 3-segment progress meter so the position in the cycle
 * is legible. The minimal-footprint option — folds the speed picker into one tap.
 */
export function PartySpeedCycle({ value, onChange, disabled }: SpeedWidgetProps) {
  const idx = speedIndex(value);
  const cycle = () => {
    const next = PARTY_SPEEDS[(idx + 1) % PARTY_SPEEDS.length];
    if (next) onChange(next.speed);
  };

  return (
    <button
      type="button"
      aria-label={`Party speed: ${PARTY_SPEEDS[idx]?.label}`}
      onClick={cycle}
      disabled={disabled}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 14,
        width: "100%",
        padding: "12px 16px",
        borderRadius: 15,
        background: "var(--nest)",
        border: "1px solid var(--hair)",
        color: "var(--ink)",
        font: "inherit",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <span style={{ display: "flex", flexDirection: "column", gap: 2, textAlign: "left" }}>
        <span style={{ fontSize: 12, color: "var(--ink-3)", letterSpacing: ".04em" }}>SPEED</span>
        <span style={{ fontSize: 17, fontWeight: 500 }}>{PARTY_SPEEDS[idx]?.label}</span>
      </span>
      {/* 3-segment meter: filled up to and including the active stop. */}
      <span aria-hidden="true" style={{ display: "flex", gap: 5 }}>
        {PARTY_SPEEDS.map(({ speed }, i) => (
          <span
            key={speed}
            style={{
              width: 22,
              height: 6,
              borderRadius: 999,
              background: i <= idx ? "var(--acc)" : "var(--hair-2)",
              transition: "background .12s ease",
            }}
          />
        ))}
      </span>
    </button>
  );
}
