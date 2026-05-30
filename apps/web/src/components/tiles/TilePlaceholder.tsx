import { Icon, type IconName } from "../Icon";

export interface TilePlaceholderProps {
  label: string;
  icon: IconName;
}

/**
 * Scaffold placeholder. Renders a labeled, empty `.tile` so every tile's file
 * path exists and the board renders end-to-end. Frontend agents overwrite the
 * individual tile components with the real designs.
 */
export function TilePlaceholder({ label, icon }: TilePlaceholderProps) {
  return (
    <div
      className="tile"
      style={{
        height: "100%",
        padding: 22,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div className="sec">
        <span className="ic">
          <Icon name={icon} s={16} c="var(--ink-2)" />
        </span>
        <span className="lbl">{label}</span>
      </div>
      <div
        style={{
          flex: 1,
          display: "grid",
          placeItems: "center",
          color: "var(--ink-3)",
        }}
      >
        <Icon name={icon} s={40} c="var(--ink-3)" sw={1.3} />
      </div>
    </div>
  );
}
