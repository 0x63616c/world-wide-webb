/**
 * ControlTap , standalone dumb presentational control cell.
 * Zero trpc/data/hook dependencies; all state driven by props.
 */

import { Icon, type IconName } from "../Icon";

export interface ControlTapProps {
  icon: "lamp" | "bulb" | "fan";
  label: string;
  on: boolean;
  sub?: string;
  pending?: boolean;
  /**
   * Optional color (any CSS color). When set, a filled circle of this color
   * renders in place of the Icon , used for scene swatches (e.g. party palette,
   * warm white). The `icon` prop is still required but ignored when swatch is set.
   */
  swatch?: string;
  /** Non-interactive + dimmed; click does nothing. Used e.g. Party tile when lamps are off. */
  disabled?: boolean;
  onToggle: () => void;
}

export function ControlTap({
  icon,
  label,
  on,
  sub,
  pending,
  swatch,
  disabled,
  onToggle,
}: ControlTapProps) {
  const statusText = on ? (sub ?? "On") : "Off";

  // The bulb (Lights) glyph swaps by on-state for evee parity (www-cojw): a lit
  // Lightbulb when on, a struck-through LightbulbOff when off. lamp/fan keep a
  // single glyph and signal state purely via colour (+ fan spin).
  const glyph: IconName = icon === "bulb" && !on ? "bulb-off" : icon;

  return (
    <button
      type="button"
      className={`tap${on ? " on" : ""}`}
      onClick={onToggle}
      disabled={disabled}
      data-pending={pending ? "true" : undefined}
      style={{
        // Tighter bottom edge: top/sides 17, bottom 12 so the label + On/Off
        // row sits closer to the button's bottom edge (used on board + modal).
        padding: "17px 17px 12px",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        cursor: disabled ? "default" : "pointer",
        textAlign: "left",
        font: "inherit",
        color: "inherit",
        background: "none",
        // Disabled wins over pending for the dim cue (and blocks interaction below).
        opacity: disabled ? 0.4 : pending ? 0.7 : 1,
      }}
      aria-pressed={on}
      aria-label={label}
    >
      {/* Top row: icon left, status dot right.
          width:100% sidesteps an iOS Safari bug where a <button> column-flex
          container fails to stretch its children, collapsing space-between. */}
      <div
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        {swatch ? (
          <span
            data-swatch=""
            style={{
              width: 26,
              height: 26,
              borderRadius: "50%",
              background: swatch,
              // Subtle ring so pale swatches (warm white) stay visible on the tile.
              boxShadow: "inset 0 0 0 1px var(--hair-2)",
            }}
          />
        ) : icon === "fan" ? (
          <span
            data-fan-spin=""
            style={{
              display: "inline-flex",
              animation: "spin 10s linear infinite",
              animationPlayState: on ? "running" : "paused",
            }}
          >
            <Icon name="fan" s={26} c={on ? "var(--acc)" : "var(--ink-2)"} />
          </span>
        ) : (
          <Icon name={glyph} s={26} c={on ? "var(--acc)" : "var(--ink-2)"} />
        )}
        <span className="sd" />
      </div>

      {/* Bottom row: label left, On/Off status right , same baseline.
          width:100% for the same iOS Safari button-flex stretch bug as above. */}
      <div
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <span style={{ fontSize: 18, fontWeight: 500 }}>{label}</span>
        <span
          className="mono"
          style={{
            fontSize: 12,
            color: on ? "var(--acc)" : "var(--ink-3)",
            textTransform: "uppercase",
            letterSpacing: ".08em",
          }}
        >
          {statusText}
        </span>
      </div>
    </button>
  );
}
