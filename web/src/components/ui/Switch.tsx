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
const BORDER = 1;
// The track is `box-sizing: border-box` (global reset), so the 1px border eats
// into the 44x26 box: absolute children position from the *inside* of the
// border. Center the knob within the inner box (TRACK - 2*BORDER) or it sits low
// (more gap on top than bottom).
const PAD = (TRACK_H - 2 * BORDER - KNOB) / 2;
const TRAVEL = TRACK_W - 2 * BORDER - KNOB - PAD * 2;

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
          transform: checked ? `translateX(${TRAVEL}px)` : "translateX(0)",
          transition: "transform 0.18s ease, background 0.18s ease",
        }}
      />
    </button>
  );
}
