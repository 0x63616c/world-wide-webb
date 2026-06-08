import type { ReactNode } from "react";
import type { IconName } from "../Icon";
import { Icon } from "../Icon";

interface TileHeaderProps {
  icon: IconName;
  title: string;
  right?: ReactNode;
  iconSize?: number;
  titleSize?: number;
}

export function TileHeader({
  icon,
  title,
  right,
  iconSize = 19,
  titleSize = 17.5,
}: TileHeaderProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 16,
      }}
    >
      <Icon name={icon} s={iconSize} c="var(--ink-2)" />
      <span
        style={{
          fontSize: titleSize,
          fontWeight: 600,
          letterSpacing: "-0.015em",
        }}
      >
        {title}
      </span>
      {right && <div style={{ marginLeft: "auto" }}>{right}</div>}
    </div>
  );
}
