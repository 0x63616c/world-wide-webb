import type { CSSProperties, ReactNode } from "react";

interface PillProps {
  tone?: "default" | "on" | "amber";
  children: ReactNode;
  style?: CSSProperties;
}

export function Pill({ tone = "default", children, style }: PillProps) {
  const cls = tone === "default" ? "pill" : `pill ${tone}`;
  return (
    <span className={cls} style={style}>
      {children}
    </span>
  );
}
