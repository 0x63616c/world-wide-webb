import type { ReactNode } from "react";
import { BackButton } from "../settings-page/blocks";

/**
 * Shared sticky header row for fullscreen pages (tile detail, photo booth
 * gallery, etc.). A `flexShrink: 0` row of BackButton + h1 title with an
 * optional right slot pushed to the far edge.
 *
 * Pages using this must be a flex-column whose scroll region is
 * `flex: 1; minHeight: 0; overflowY: auto`, so the header stays pinned above
 * the scrolling content. Metrics (gap 14, padding 24, h1 28/700) match the
 * legacy TileDetailHost header exactly so adoption is visually a no-op.
 */
export function PageHeader({
  title,
  onBack,
  right,
}: {
  title: string;
  onBack: () => void;
  right?: ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: 24, flexShrink: 0 }}>
      <BackButton onClick={onBack} />
      <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>{title}</h1>
      {right != null && <div style={{ marginLeft: "auto" }}>{right}</div>}
    </div>
  );
}
