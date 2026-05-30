import type { ReactNode } from "react";

interface StatProps {
  label: string;
  value: ReactNode;
  accent?: boolean;
  sub?: string;
}

export function Stat({ label, value, accent, sub }: StatProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span className="cap">{label}</span>
      <span
        data-stat-value
        className="mono"
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: accent ? "var(--acc)" : undefined,
        }}
      >
        {value}
      </span>
      {sub && <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{sub}</span>}
    </div>
  );
}
