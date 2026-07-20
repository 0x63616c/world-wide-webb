import { Tile, TileHeader } from "@/components/ui";

/**
 * Design 05 , "Filmstrip" (5x3).
 * A 35mm strip runs across the tile: sprocket-hole edges and a row of frames.
 * Frames are decorative procedural gradients (no real photos). The last frame is
 * an empty "+" slot inviting the next shot.
 */
const FRAME_GRADS = [
  "linear-gradient(160deg, #ff8a5c, #d1345b)",
  "linear-gradient(160deg, #2b8fd6, #23d5ab)",
  "linear-gradient(160deg, #8a5cff, #4568dc)",
  "linear-gradient(160deg, #f6d365, #fda085)",
];

function Sprockets() {
  return (
    <div style={{ display: "flex", gap: 8, padding: "5px 8px", justifyContent: "space-between" }}>
      {Array.from({ length: 9 }, (_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed decorative sprocket row
          key={i}
          style={{
            width: 12,
            height: 8,
            borderRadius: 2,
            background: "var(--bg)",
            flex: "0 0 auto",
          }}
        />
      ))}
    </div>
  );
}

export function TileDesign05() {
  return (
    <Tile padding={18} style={{ overflow: "hidden" }}>
      <TileHeader icon="cam" title="Photo booth" iconSize={17} titleSize={16} />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          background: "#161616",
          border: "1px solid var(--hair)",
          borderRadius: 8,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          overflow: "hidden",
        }}
      >
        <Sprockets />
        <div style={{ display: "flex", gap: 8, padding: "0 10px", flex: 1, minHeight: 0 }}>
          {FRAME_GRADS.map((g) => (
            <div
              key={g}
              style={{
                flex: 1,
                borderRadius: 4,
                background: g,
                boxShadow: "inset 0 0 0 1px rgba(0,0,0,.25)",
              }}
            />
          ))}
          <div
            style={{
              flex: 1,
              borderRadius: 4,
              border: "1.5px dashed var(--hair-2)",
              display: "grid",
              placeItems: "center",
              color: "var(--ink-3)",
              fontSize: 24,
              fontWeight: 300,
            }}
          >
            +
          </div>
        </div>
        <Sprockets />
      </div>
      <div className="cap" style={{ marginTop: 12 }}>
        tap to shoot the next frame
      </div>
    </Tile>
  );
}

export const PhotoBoothFilmstrip = TileDesign05;
