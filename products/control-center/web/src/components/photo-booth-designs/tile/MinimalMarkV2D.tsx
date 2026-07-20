import { Icon } from "@/components/Icon";
import { Tile, TileHeader } from "@/components/ui";

/**
 * Minimal Mark V2 · D , "Booth" (2x2).
 * The one larger option, and the most native: it opens with the real shared
 * `TileHeader` (cam icon + full "Photo booth" title) exactly like every
 * registered tile, so it identifies itself the same way its neighbours do.
 * Below sits a single lens motif , the nest chip rounded to a circle with one
 * thin accent ring , and a quiet accent `.cap` affordance. Minimal, but with
 * enough room to read the name at a glance.
 */
export function MinimalMarkV2D() {
  return (
    <Tile padding={20}>
      {/* Title MUST stay in sync with the registry label when this ships. */}
      <TileHeader icon="camera" title="Photo booth" />
      <div style={{ flex: 1, minHeight: 0, display: "grid", placeItems: "center" }}>
        <div
          style={{
            position: "relative",
            width: 84,
            height: 84,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            background: "var(--nest)",
            border: "1px solid var(--hair)",
            boxShadow: "inset 0 1px 0 0 rgba(255,255,255,.04)",
          }}
        >
          <span
            style={{
              position: "absolute",
              inset: 10,
              borderRadius: "50%",
              border: "1px solid var(--acc-line)",
            }}
          />
          <Icon name="camera" s={30} c="var(--ink)" sw={1.6} />
        </div>
      </div>
      <div className="cap acc" style={{ textAlign: "center", marginTop: 4 }}>
        tap to snap
      </div>
    </Tile>
  );
}
