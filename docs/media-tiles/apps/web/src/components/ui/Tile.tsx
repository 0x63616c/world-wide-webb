import type { CSSProperties, MouseEventHandler, ReactNode } from "react";

interface TileProps {
  padding?: number;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  // Optional tap handler for tiles that own their own tap surface (e.g. opening a
  // detail modal). Left undefined for tiles whose tap is handled by the board.
  onClick?: MouseEventHandler<HTMLDivElement>;
}

export function Tile({ padding, children, className, style, onClick }: TileProps) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: optional tap surface; keyboard activation is provided by the board's role=button wrapper around the tile
    // biome-ignore lint/a11y/useKeyWithClickEvents: see above — keyboard handled by the enclosing board wrapper
    <div
      className={`tile${className ? ` ${className}` : ""}`}
      onClick={onClick}
      style={{
        height: "100%",
        padding,
        display: "flex",
        flexDirection: "column",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
