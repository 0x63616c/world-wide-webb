import { Icon } from "@/components/Icon";
import { Tile } from "@/components/ui";

/**
 * PhotoBoothTile , the board face for the photo-booth feature (1x1, productionised
 * from the approved "Minimal Mark V2 · B" prototype). A mark-only tile: the camera
 * glyph sits inside the house nest chip (the same rounded-square recipe the
 * section-label `.ic` and TileDesign01 use), giving the mark presence without a
 * label. The one accent touch is the shared `.dot` in the corner , a static accent
 * in v1 (the booth carries no live board state), reading as "booth is here" the way
 * the media/network tiles signal live.
 *
 * Tapping the tile opens the fullscreen camera via the board's tile-detail registry
 * (detail/wiring/photo-booth.tsx), which hosts the camera ⇄ gallery navigation.
 * The tile itself is presentational and takes no props, so it serves as both the
 * board `component` and the minimap `viewComponent` in lib/tile-registry.ts.
 */
export function PhotoBoothTile() {
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
