import { Icon } from "@/components/Icon";
import { Tile, TileHeader } from "@/components/ui";

/**
 * PhotoBoothTile , the board face for the photo-booth feature (2x2, titled). A
 * standard TileHeader ("Photo Booth" + camera glyph) over a quiet body: the
 * camera mark sits inside the house nest chip (the same rounded-square recipe the
 * section-label `.ic` and TileDesign01 use). No status dot: the booth carries no
 * live board state, so nothing should read as one.
 *
 * Tapping the tile opens the fullscreen camera via the board's tile-detail registry
 * (detail/wiring/photo-booth.tsx), which hosts the camera ⇄ gallery navigation.
 * The tile itself is presentational and takes no props, so it serves as both the
 * board `component` and the minimap `viewComponent` in lib/tile-registry.ts.
 *
 * The title MUST stay in sync with the registry label in lib/tile-registry.ts
 * (asserted by tile-title-sync.test.tsx).
 */
export function PhotoBoothTile() {
  return (
    <Tile padding={22}>
      <TileHeader icon="camera" title="Photo Booth" />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          position: "relative",
          display: "grid",
          placeItems: "center",
        }}
      >
        <div
          style={{
            width: 58,
            height: 58,
            borderRadius: 16,
            background: "var(--nest)",
            border: "1px solid var(--hair)",
            display: "grid",
            placeItems: "center",
            boxShadow: "inset 0 1px 0 0 rgba(255,255,255,.04)",
          }}
        >
          <Icon name="camera" s={28} c="var(--ink)" sw={1.6} />
        </div>
      </div>
    </Tile>
  );
}
