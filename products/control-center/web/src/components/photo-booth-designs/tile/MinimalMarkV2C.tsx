import { Icon } from "@/components/Icon";
import { Tile } from "@/components/ui";

/**
 * Minimal Mark V2 · C , "Chip + micro-label" (1x1).
 * Same framed nest chip as B, but the accent is dropped in favour of one quiet
 * `.cap` line , the house uppercase micro-label used across every tile face. At
 * 1x1 the full "Photo booth" won't fit, so the label shortens to "Photo" and the
 * glyph carries the rest. The most legible of the icon-only trio for anyone who
 * needs a word.
 */
export function MinimalMarkV2C() {
  return (
    <Tile padding={14}>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 9,
        }}
      >
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: 13,
            background: "var(--nest)",
            border: "1px solid var(--hair)",
            display: "grid",
            placeItems: "center",
            boxShadow: "inset 0 1px 0 0 rgba(255,255,255,.04)",
          }}
        >
          <Icon name="camera" s={21} c="var(--ink-2)" sw={1.6} />
        </div>
        <span className="cap">Photo</span>
      </div>
    </Tile>
  );
}
