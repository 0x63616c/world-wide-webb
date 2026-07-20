import { Icon } from "@/components/Icon";
import { Tile } from "@/components/ui";

/**
 * Design 08 , "Aurora Glass" (4x3).
 * A vivid aurora gradient sits behind a frosted-glass card. Glassmorphism gives
 * the tile a soft, premium camera-app feel while staying on the dark board. The
 * gradient is purely decorative.
 */
export function TileDesign08() {
  return (
    <Tile padding={0} style={{ overflow: "hidden" }}>
      {/* Aurora blobs */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(60% 70% at 18% 22%, rgba(0,112,243,.85), transparent 60%)," +
            "radial-gradient(55% 65% at 82% 30%, rgba(176,106,179,.75), transparent 62%)," +
            "radial-gradient(70% 80% at 60% 100%, rgba(111,219,203,.6), transparent 60%)," +
            "#0a0a0a",
        }}
      />
      {/* Frosted card */}
      <div
        style={{
          position: "relative",
          margin: "auto",
          width: "82%",
          padding: "22px 24px",
          borderRadius: 18,
          background: "rgba(12,14,17,.42)",
          border: "1px solid rgba(255,255,255,.16)",
          backdropFilter: "blur(18px)",
          WebkitBackdropFilter: "blur(18px)",
          boxShadow: "0 10px 40px -12px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.14)",
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        <div
          style={{
            flex: "0 0 auto",
            width: 52,
            height: 52,
            borderRadius: 14,
            display: "grid",
            placeItems: "center",
            background: "rgba(255,255,255,.14)",
            border: "1px solid rgba(255,255,255,.22)",
          }}
        >
          <Icon name="cam" s={26} c="#fff" sw={1.7} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 19, fontWeight: 600, letterSpacing: "-0.02em", color: "#fff" }}>
            Photo booth
          </div>
          <div className="cap" style={{ marginTop: 6, color: "rgba(255,255,255,.75)" }}>
            tap to open the camera
          </div>
        </div>
      </div>
    </Tile>
  );
}
