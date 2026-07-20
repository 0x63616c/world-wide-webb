import { Tile } from "@/components/ui";

/**
 * Design 09 , "Sticker Party" (3x3).
 * Playful sticker-sheet aesthetic: emoji stickers scatter around a rounded
 * "Say cheese!" badge. Emoji are decorative glyphs (no imagery / assets). The
 * loudest, most fun option , good for a party wall.
 */
const STICKERS: Array<{ e: string; top: string; left: string; rotate: number; size: number }> = [
  { e: "📸", top: "8%", left: "10%", rotate: -14, size: 34 },
  { e: "✨", top: "12%", left: "74%", rotate: 12, size: 26 },
  { e: "🎉", top: "70%", left: "8%", rotate: -8, size: 30 },
  { e: "⭐", top: "74%", left: "78%", rotate: 16, size: 24 },
  { e: "💫", top: "44%", left: "88%", rotate: -10, size: 22 },
];

export function TileDesign09() {
  return (
    <Tile padding={16} style={{ overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(90% 90% at 50% 40%, rgba(0,112,243,.14), transparent 70%)",
        }}
      />
      {STICKERS.map((s) => (
        <div
          key={s.e}
          style={{
            position: "absolute",
            top: s.top,
            left: s.left,
            fontSize: s.size,
            transform: `rotate(${s.rotate}deg)`,
            filter: "drop-shadow(0 3px 5px rgba(0,0,0,.5))",
            pointerEvents: "none",
          }}
        >
          {s.e}
        </div>
      ))}
      <div
        style={{
          position: "relative",
          margin: "auto",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
          padding: "16px 22px",
          borderRadius: 20,
          background: "var(--nest)",
          border: "1px solid var(--hair-2)",
          boxShadow: "0 10px 26px -10px rgba(0,0,0,.7)",
          transform: "rotate(-3deg)",
        }}
      >
        <span style={{ fontSize: 30 }}>😄</span>
        <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em" }}>Say cheese!</span>
        <span className="cap acc">tap to snap</span>
      </div>
    </Tile>
  );
}
