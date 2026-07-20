import { Icon } from "@/components/Icon";
import { Tile } from "@/components/ui";

/**
 * Design 01 , "Minimal Mark" (2x2).
 * Ultra-minimal, monochrome entry point: a single camera glyph, the label, and
 * one quiet affordance line. The quietest possible statement of "take photos
 * here" , leans entirely on the house tile chrome for polish.
 */
export function TileDesign01() {
  return (
    <Tile padding={20}>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 54,
            height: 54,
            borderRadius: 16,
            background: "var(--nest)",
            border: "1px solid var(--hair)",
            display: "grid",
            placeItems: "center",
            boxShadow: "inset 0 1px 0 0 rgba(255,255,255,.04)",
          }}
        >
          <Icon name="cam" s={26} c="var(--ink-2)" sw={1.6} />
        </div>
        <div>
          <div style={{ fontSize: 15.5, fontWeight: 600, letterSpacing: "-0.015em" }}>
            Photo booth
          </div>
          <div className="cap" style={{ marginTop: 6 }}>
            tap to snap
          </div>
        </div>
      </div>
    </Tile>
  );
}

export const PhotoBoothMinimalMark = TileDesign01;
