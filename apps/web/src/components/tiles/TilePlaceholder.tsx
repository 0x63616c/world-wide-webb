import { Icon, type IconName } from "@/components/Icon";
import { Tile, TileHeader } from "@/components/ui";

export interface TilePlaceholderProps {
  label: string;
  icon: IconName;
}

/**
 * Scaffold placeholder. Renders a labeled, empty tile so every tile's file
 * path exists and the board renders end-to-end. Frontend agents overwrite the
 * individual tile components with the real designs.
 */
export function TilePlaceholder({ label, icon }: TilePlaceholderProps) {
  return (
    <Tile padding={22} style={{ gap: 10 }}>
      <TileHeader icon={icon} title={label} />
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
    </Tile>
  );
}
