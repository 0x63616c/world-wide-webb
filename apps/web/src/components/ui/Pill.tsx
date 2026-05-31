import type { CSSProperties, ReactNode } from "react";

export const PillTone = {
  Default: "default",
  On: "on",
  Amber: "amber",
} as const;
export type PillTone = (typeof PillTone)[keyof typeof PillTone];

interface PillProps {
  tone?: PillTone;
  children: ReactNode;
  style?: CSSProperties;
}

export function Pill({ tone = PillTone.Default, children, style }: PillProps) {
  const cls = tone === PillTone.Default ? "pill" : `pill ${tone}`;
  return (
    <span className={cls} style={style}>
      {children}
    </span>
  );
}
