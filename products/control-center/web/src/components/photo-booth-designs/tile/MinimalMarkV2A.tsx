import { Icon } from "@/components/Icon";
import { Tile } from "@/components/ui";

/**
 * Minimal Mark V2 · A , "Bare glyph" (1x1).
 * The absolute floor of the concept: a single house camera glyph centered on the
 * bare tile surface, no chip, no label, no accent. At 1x1 (~94px) the glyph is
 * the whole tile , it leans entirely on the shared `.tile` chrome (radius,
 * hairline, inset highlight) so it sits native beside the other small tiles.
 */
export function MinimalMarkV2A() {
  return (
    <Tile>
      <div style={{ flex: 1, minHeight: 0, display: "grid", placeItems: "center" }}>
        <Icon name="camera" s={30} c="var(--ink-2)" sw={1.6} />
      </div>
    </Tile>
  );
}
