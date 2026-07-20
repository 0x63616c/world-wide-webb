import { Tile } from "@/components/ui";

/**
 * Design 04 , "Viewfinder" (4x4).
 * A camera viewfinder frame: rule-of-thirds guides, corner brackets, a focus
 * reticle and a framing HUD. The framed area is an obviously abstract gradient
 * (not a fake live feed), so it signals "camera" without pretending to show one.
 */
export function TileDesign04() {
  const bracket = (pos: { top?: number; bottom?: number; left?: number; right?: number }) => (
    <div
      style={{
        position: "absolute",
        width: 22,
        height: 22,
        borderColor: "var(--acc)",
        borderStyle: "solid",
        borderWidth: `${pos.top !== undefined ? 2 : 0}px ${
          pos.right !== undefined ? 2 : 0
        }px ${pos.bottom !== undefined ? 2 : 0}px ${pos.left !== undefined ? 2 : 0}px`,
        borderTopLeftRadius: pos.top !== undefined && pos.left !== undefined ? 6 : 0,
        borderTopRightRadius: pos.top !== undefined && pos.right !== undefined ? 6 : 0,
        borderBottomLeftRadius: pos.bottom !== undefined && pos.left !== undefined ? 6 : 0,
        borderBottomRightRadius: pos.bottom !== undefined && pos.right !== undefined ? 6 : 0,
        ...pos,
      }}
    />
  );

  return (
    <Tile padding={16}>
      <div className="feed" style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {/* Abstract framed gradient (decorative, not a live feed) */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(120% 90% at 30% 20%, #14324f 0%, #0a0a0a 60%), linear-gradient(160deg, rgba(0,112,243,.18), transparent 55%)",
          }}
        />
        <div className="scan" />
        {/* Rule-of-thirds guides */}
        {[33.33, 66.66].map((p) => (
          <div
            key={`v${p}`}
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `${p}%`,
              width: 1,
              background: "rgba(255,255,255,.10)",
            }}
          />
        ))}
        {[33.33, 66.66].map((p) => (
          <div
            key={`h${p}`}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: `${p}%`,
              height: 1,
              background: "rgba(255,255,255,.10)",
            }}
          />
        ))}
        {/* Focus reticle */}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: 58,
            height: 58,
            transform: "translate(-50%, -50%)",
            border: "1.5px solid rgba(255,255,255,.55)",
            borderRadius: 8,
          }}
        />
        {/* Corner brackets */}
        {bracket({ top: 12, left: 12 })}
        {bracket({ top: 12, right: 12 })}
        {bracket({ bottom: 12, left: 12 })}
        {bracket({ bottom: 12, right: 12 })}
        {/* HUD */}
        <div
          style={{
            position: "absolute",
            top: 14,
            left: 16,
            display: "flex",
            alignItems: "center",
            gap: 7,
          }}
        >
          <span className="dot" />
          <span
            className="mono"
            style={{ fontSize: 11, color: "var(--acc)", letterSpacing: ".14em" }}
          >
            READY
          </span>
        </div>
        <div
          className="mono"
          style={{
            position: "absolute",
            top: 14,
            right: 16,
            fontSize: 11,
            color: "var(--ink-2)",
            letterSpacing: ".1em",
          }}
        >
          f/2.8
        </div>
        <div
          style={{
            position: "absolute",
            left: 16,
            right: 16,
            bottom: 14,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontSize: 16, fontWeight: 600, textShadow: "0 1px 6px #000" }}>
            Photo booth
          </span>
          <span className="cap" style={{ textShadow: "0 1px 6px #000" }}>
            tap to open
          </span>
        </div>
      </div>
    </Tile>
  );
}
