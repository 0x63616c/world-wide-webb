import type { CSSProperties, ReactNode } from "react";

interface TileProps {
  padding?: number;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function Tile({ padding, children, className, style }: TileProps) {
  return (
    <div
      className={`tile${className ? ` ${className}` : ""}`}
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
