/**
 * ControlTap — standalone dumb presentational control cell.
 * Zero trpc/data/hook dependencies; all state driven by props.
 */

import { Icon } from "../Icon";

export interface ControlTapProps {
  icon: "lamp" | "bulb" | "fan";
  label: string;
  on: boolean;
  sub?: string;
  pending?: boolean;
  onToggle: () => void;
}

export function ControlTap({ icon, label, on, sub, pending, onToggle }: ControlTapProps) {
  const statusText = on ? (sub ?? "On") : "Off";

  return (
    <button
      type="button"
      className={`tap${on ? " on" : ""}`}
      onClick={onToggle}
      data-pending={pending ? "true" : undefined}
      style={{
        padding: 17,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        cursor: "pointer",
        textAlign: "left",
        font: "inherit",
        color: "inherit",
        background: "none",
        opacity: pending ? 0.7 : 1,
      }}
      aria-pressed={on}
      aria-label={label}
    >
      {/* Top row: icon left, status dot right */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        {icon === "fan" ? (
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
          <Icon name={icon} s={26} c={on ? "var(--acc)" : "var(--ink-2)"} />
        )}
        <span className="sd" />
      </div>

      {/* Bottom row: label left, On/Off status right — same baseline */}
      <div
        style={{
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
