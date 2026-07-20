import { Tile } from "@/components/ui";

/**
 * Design 06 , "Marquee" (6x4).
 * A retro fairground / cinema booth sign: a warm glowing bulb border chases
 * around a bold "PHOTO BOOTH" wordmark. The showiest of the set , meant to read
 * as an invitation to step right up.
 */
function BulbBorder() {
  const bulbs: Array<{ x: number; y: number; i: number }> = [];
  const cols = 12;
  const rows = 7;
  for (let c = 0; c < cols; c++) {
    bulbs.push({ x: (c / (cols - 1)) * 100, y: 0, i: c });
    bulbs.push({ x: (c / (cols - 1)) * 100, y: 100, i: c + 100 });
  }
  for (let r = 1; r < rows - 1; r++) {
    bulbs.push({ x: 0, y: (r / (rows - 1)) * 100, i: r + 200 });
    bulbs.push({ x: 100, y: (r / (rows - 1)) * 100, i: r + 300 });
  }
  return (
    <>
      {bulbs.map((b) => {
        const warm = b.i % 2 === 0;
        return (
          <div
            key={b.i}
            style={{
              position: "absolute",
              left: `${b.x}%`,
              top: `${b.y}%`,
              width: 9,
              height: 9,
              borderRadius: "50%",
              transform: "translate(-50%, -50%)",
              background: warm ? "var(--amber)" : "#fff4d6",
              boxShadow: warm
                ? "0 0 8px 1px rgba(244,192,99,.75)"
                : "0 0 8px 1px rgba(255,244,214,.6)",
            }}
          />
        );
      })}
    </>
  );
}

export function TileDesign06() {
  return (
    <Tile padding={0} style={{ overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(120% 100% at 50% 0%, #241a10 0%, #0a0a0a 65%)",
        }}
      />
      <div style={{ position: "absolute", inset: 20 }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            border: "1px solid rgba(244,192,99,.25)",
            borderRadius: 14,
          }}
        />
        <BulbBorder />
      </div>
      <div
        style={{
          position: "relative",
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
        <div className="cap" style={{ color: "var(--amber)", letterSpacing: ".28em" }}>
          ★ step right in ★
        </div>
        <div
          style={{
            fontSize: 46,
            fontWeight: 700,
            lineHeight: 0.98,
            letterSpacing: "-0.02em",
            color: "#fff7e8",
            textShadow: "0 0 18px rgba(244,192,99,.35)",
          }}
        >
          PHOTO
          <br />
          BOOTH
        </div>
        <div className="cap" style={{ color: "var(--ink-2)" }}>
          tap to strike a pose
        </div>
      </div>
    </Tile>
  );
}

export const PhotoBoothMarquee = TileDesign06;
