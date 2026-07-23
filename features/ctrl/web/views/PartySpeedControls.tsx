/**
 * Party-speed widgets , the www-7d5b.3.7 speed spike, presentational only.
 *
 * Three competing affordances for choosing the party animation speed, built so
 * Calum can FEEL all three on real lamps and keep the winner. Every widget is
 * props-only (`value` + `onChange`) , zero trpc/hooks , so they drop straight
 * into ExpandedControlsView once setLampMode (www-7d5b.3.4) lands. The
 * wiring layer maps this frontend `PartySpeed` onto the backend speed enum.
 *
 * Speeds mirror the plan's LampModeSpeed (Slow/Medium/Fast). The labels here are
 * the canonical display strings the wiring + tests rely on.
 */

import { Slider } from "@/components/ui/Slider";

// ─── speed model ───────────────────────────────────────────────────────────────

export const PartySpeed = {
  Slow: "slow",
  Medium: "medium",
  Fast: "fast",
} as const;
export type PartySpeed = (typeof PartySpeed)[keyof typeof PartySpeed];

// Ordered slow→fast , the array index doubles as the slider position and the
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
 * Segmented pill , three side-by-side options, the active one filled with --acc.
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
              color: active ? "var(--bg)" : "var(--ink-2)",
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
 * Three-stop slider , the shared Slider in stops mode. Snaps to the discrete
 * speeds (no in-between values , speed is categorical), with the stop labels
 * beneath, so the thumb/track match every other slider in the app.
 */
export function PartySpeedSlider({ value, onChange, disabled }: SpeedWidgetProps) {
  const idx = speedIndex(value);

  return (
    <Slider
      value={idx}
      min={0}
      max={PARTY_SPEEDS.length - 1}
      step={1}
      label="Party speed"
      showHeader={false}
      disabled={disabled}
      stops={PARTY_SPEEDS.map(({ label }) => label)}
      onChange={(next) => {
        const speed = PARTY_SPEEDS[next];
        if (speed) onChange(speed.speed);
      }}
    />
  );
}

// ─── full-width party control (Off / Slow / Med / Fast) ─────────────────────────

/**
 * The shipping party affordance: one full-width segmented control that folds the
 * on/off toggle AND the speed picker into a single row. "Off" stops party; tapping
 * any speed starts party at that speed (or re-speeds a running party). This replaces
 * the separate Party tile + conditional speed segment , one control, four taps.
 *
 * `value` is "off" when party isn't running, else the active speed. Speed segments
 * light with the party gradient (signalling party is LIVE); "Off" lights muted.
 */

export type PartySelection = "off" | PartySpeed;

// The four segments: Off, then the ordered speeds. Single source of truth for
// order + label, derived from PARTY_SPEEDS so it can never drift from the slider/cycle.
const PARTY_OPTIONS: { value: PartySelection; label: string }[] = [
  { value: "off", label: "Off" },
  ...PARTY_SPEEDS.map(({ speed, label }) => ({ value: speed as PartySelection, label })),
];

// Horizontal party gradient , the active-speed fill, echoing the party scene swatch
// so the control reads as "party is running" at a glance.
const PARTY_GRADIENT = "linear-gradient(90deg, #ff3b3b, #ffb800, #38d39f, #2b6bff, #a855f7)";

interface PartyControlProps {
  /** Current selection , "off" when party isn't running, else the active speed. */
  value: PartySelection;
  onSelect: (value: PartySelection) => void;
  /** Dimmed + non-interactive (no lamps lit , party needs at least one lamp). */
  disabled?: boolean;
}

export function PartyControl({ value, onSelect, disabled }: PartyControlProps) {
  return (
    <div
      role="tablist"
      aria-label="Party"
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
      {PARTY_OPTIONS.map(({ value: option, label }) => {
        const active = option === value;
        const isOff = option === "off";
        // Active off → muted neutral fill; active speed → party gradient. Inactive →
        // transparent. White text on the gradient, ink on the muted off pill.
        const background = active ? (isOff ? "var(--hair-2)" : PARTY_GRADIENT) : "transparent";
        const color = active ? (isOff ? "var(--ink)" : "#ffffff") : "var(--ink-2)";
        return (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={label}
            disabled={disabled}
            onClick={() => onSelect(option)}
            style={{
              flex: 1,
              padding: "11px 0",
              borderRadius: 999,
              border: "none",
              cursor: disabled ? "default" : "pointer",
              font: "inherit",
              fontSize: 14,
              fontWeight: 500,
              letterSpacing: ".02em",
              color,
              background,
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

// ─── (c) tap-to-cycle ─────────────────────────────────────────────────────────

/**
 * Single tap target that cycles Slow → Med → Fast → Slow on each press, showing
 * the current speed and a 3-segment progress meter so the position in the cycle
 * is legible. The minimal-footprint option , folds the speed picker into one tap.
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
