import { Tile } from "@/components/ui";

/**
 * Design 10 , "The Booth" (4x4).
 * A literal photo-booth: two drawn curtain panels frame a dark opening with a
 * flash burst and a small "PHOTO BOOTH" sign. Evokes the classic mall booth ,
 * step through the curtain to shoot.
 */
function Curtain({ side }: { side: "left" | "right" }) {
  const dir = side === "left" ? 1 : -1;
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        [side]: 0,
        width: "30%",
        background:
          "repeating-linear-gradient(90deg, #6d1524 0 10px, #8f1d31 10px 14px, #5a1020 14px 22px)",
        boxShadow:
          side === "left"
            ? "inset -14px 0 22px -10px rgba(0,0,0,.75)"
            : "inset 14px 0 22px -10px rgba(0,0,0,.75)",
        borderRadius: side === "left" ? "0 12px 12px 0" : "12px 0 0 12px",
        transform: `skewX(${dir * 2}deg)`,
        transformOrigin: side === "left" ? "left" : "right",
      }}
    />
  );
}

export function TileDesign10() {
  return (
    <Tile padding={0} style={{ overflow: "hidden" }}>
      {/* Booth interior */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(70% 60% at 50% 42%, #1b1b1b 0%, #070707 70%)",
        }}
      />
      <Curtain side="left" />
      <Curtain side="right" />
      {/* Flash burst */}
      <div
        style={{
          position: "absolute",
          top: "30%",
          left: "50%",
          width: 120,
          height: 120,
          transform: "translate(-50%, -50%)",
          background: "radial-gradient(circle, rgba(255,255,255,.85) 0%, rgba(255,255,255,0) 62%)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          textAlign: "center",
        }}
      >
        {/* Marquee sign */}
        <div
          style={{
            padding: "7px 16px",
            borderRadius: 8,
            background: "rgba(0,0,0,.5)",
            border: "1px solid var(--hair-2)",
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: ".22em",
            color: "#fff7e8",
            textShadow: "0 0 12px rgba(244,192,99,.5)",
          }}
        >
          PHOTO BOOTH
        </div>
        <div style={{ fontSize: 40 }}>📷</div>
        <div
          className="cap"
          style={{
            color: "var(--ink)",
            background: "rgba(0,0,0,.4)",
            padding: "6px 12px",
            borderRadius: 999,
          }}
        >
          step in , tap to start
        </div>
      </div>
    </Tile>
  );
}
