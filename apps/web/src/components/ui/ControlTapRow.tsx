/**
 * ControlTapRow , a horizontal-bar sibling of ControlTap: icon, label, and
 * on/off status on a single row instead of ControlTap's icon-then-label
 * column layout. Used for a group's master toggle (e.g. a "Lamps" card
 * header sitting above its room sub-controls) and for compact utility
 * toggles that don't need a two-row cell.
 *
 * Zero trpc/data/hook dependencies; all state driven by props, same as
 * ControlTap.
 */

import { Icon, type IconName } from "../Icon";

// Same glyph / label / status scale as ControlTap, so a row header (e.g. the
// "Lamps" master) sitting over ControlTap sub-cells reads as one family of
// buttons instead of a smaller bar over bigger cells.
const ICON_SIZE = 26;
const LABEL_SIZE = 18;
const STATUS_SIZE = 12;

export interface ControlTapRowProps {
  icon: "lamp" | "bulb" | "fan" | "bolt";
  label: string;
  on: boolean;
  pending?: boolean;
  /** Non-interactive + dimmed; click does nothing. */
  disabled?: boolean;
  onToggle: () => void;
}

export function ControlTapRow({
  icon,
  label,
  on,
  pending,
  disabled,
  onToggle,
}: ControlTapRowProps) {
  const statusText = on ? "On" : "Off";

  // Same bulb on/off glyph swap as ControlTap (www-cojw evee parity); lamp/fan/bolt
  // keep a single glyph and signal state purely via color (+ fan spin).
  const glyph: IconName = icon === "bulb" && !on ? "bulb-off" : icon;

  return (
    <button
      type="button"
      className={`tap-row${on ? " on" : ""}`}
      onClick={onToggle}
      disabled={disabled}
      data-pending={pending ? "true" : undefined}
      style={{
        width: "100%",
        // Content-sized (not height:100%) , this cell fills a fixed grid row in
        // some call sites and sits as a natural-height item above a sub-row in
        // others, so its own padding is the one thing that has to be right in
        // both.
        padding: "13px 16px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        cursor: disabled ? "default" : "pointer",
        textAlign: "left",
        font: "inherit",
        color: "inherit",
        background: "none",
        opacity: disabled ? 0.4 : pending ? 0.7 : 1,
      }}
      aria-pressed={on}
      aria-label={label}
    >
      {icon === "fan" ? (
        <span
          data-fan-spin=""
          style={{
            display: "inline-flex",
            flex: "0 0 auto",
            animation: "spin 10s linear infinite",
            animationPlayState: on ? "running" : "paused",
          }}
        >
          <Icon name="fan" s={ICON_SIZE} c={on ? "var(--acc)" : "var(--ink-2)"} />
        </span>
      ) : (
        <span style={{ flex: "0 0 auto", display: "inline-flex" }}>
          <Icon name={glyph} s={ICON_SIZE} c={on ? "var(--acc)" : "var(--ink-2)"} />
        </span>
      )}
      <span style={{ flex: 1, fontSize: LABEL_SIZE, fontWeight: 500 }}>{label}</span>
      <span
        className="mono"
        style={{
          fontSize: STATUS_SIZE,
          color: on ? "var(--acc)" : "var(--ink-3)",
          textTransform: "uppercase",
          letterSpacing: ".08em",
          flex: "0 0 auto",
        }}
      >
        {statusText}
      </span>
    </button>
  );
}
