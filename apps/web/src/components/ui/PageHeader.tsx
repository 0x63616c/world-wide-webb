import type { ReactNode } from "react";
import { BackPill } from "./BackPill";

/**
 * Shared sticky header row for fullscreen pages (tile detail, photo booth
 * gallery, etc.). A `flexShrink: 0` title row with a floating back pill and an
 * optional right slot pushed to the far edge.
 *
 * Pages using this must be a flex-column whose scroll region is
 * `flex: 1; minHeight: 0; overflowY: auto`, so the header stays pinned above
 * the scrolling content. Reserve at least 104px plus the bottom safe area in
 * the scroll region so the final content can move clear of the floating pill.
 */
export function PageHeader({
  title,
  onBack,
  right,
  backLabel,
}: {
  title: string;
  onBack: () => void;
  right?: ReactNode;
  backLabel?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: 24, flexShrink: 0 }}>
      <BackPill onBack={onBack} label={backLabel} />
      <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>{title}</h1>
      {right != null && <div style={{ marginLeft: "auto" }}>{right}</div>}
    </div>
  );
}
