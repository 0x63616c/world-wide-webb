import { Icon } from "@/components/Icon";
import { Tile } from "@/components/ui";

/**
 * Minimal Mark V2 · B , "Framed + ready" (1x1).
 * The camera glyph sits inside the house nest chip (the same rounded-square
 * recipe the section-label `.ic` and TileDesign01 use), which gives the mark
 * presence without a label. The one accent touch is the shared live `.dot` in
 * the corner , the tile's subtle-status state, reading "booth is ready" the same
 * way the media/network tiles signal live.
 */
export function MinimalMarkV2B() {
  return (
    <Tile padding={14}>
      <span className="dot" style={{ position: "absolute", top: 14, right: 14 }} />
      <div style={{ flex: 1, minHeight: 0, display: "grid", placeItems: "center" }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 14,
            background: "var(--nest)",
            border: "1px solid var(--hair)",
            display: "grid",
            placeItems: "center",
            boxShadow: "inset 0 1px 0 0 rgba(255,255,255,.04)",
          }}
        >
          <Icon name="camera" s={24} c="var(--ink)" sw={1.6} />
        </div>
      </div>
    </Tile>
  );
}
