/**
 * Switch , standalone dumb presentational on/off toggle.
 * Zero trpc/data/hook dependencies; all state driven by props. Uses the native
 * `switch` role so assistive tech announces on/off and the keyboard toggles it.
 */

export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name , the control has no visible text of its own. */
  label: string;
  disabled?: boolean;
}

const TRACK_W = 44;
const TRACK_H = 26;
const KNOB = 20;
const PAD = (TRACK_H - KNOB) / 2;

export function Switch({ checked, onChange, label, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        position: "relative",
        flexShrink: 0,
        width: TRACK_W,
        height: TRACK_H,
        padding: 0,
        borderRadius: TRACK_H,
        border: `1px solid ${checked ? "var(--acc)" : "var(--hair)"}`,
        background: checked ? "var(--acc)" : "var(--nest)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
        transition: "background 0.18s ease, border-color 0.18s ease",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          top: PAD,
          left: PAD,
          width: KNOB,
          height: KNOB,
          borderRadius: "50%",
          background: checked ? "var(--bg)" : "var(--ink-2)",
          transform: checked ? `translateX(${TRACK_W - KNOB - PAD * 2}px)` : "translateX(0)",
          transition: "transform 0.18s ease, background 0.18s ease",
        }}
      />
    </button>
  );
}
