import { Tile } from "@/components/ui";

/**
 * Design 02 , "Shutter" (3x2).
 * A big physical shutter-button motif: concentric rings that read as a camera
 * release. The button is the affordance , the whole tile invites a press. Accent
 * ring picks up the app's Vercel-blue so it feels "armed".
 */
export function TileDesign02() {
  return (
    <Tile padding={20}>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          gap: 20,
        }}
      >
        {/* Shutter button , nested rings */}
        <div
          style={{
            flex: "0 0 auto",
            width: 92,
            height: 92,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            border: "2px solid var(--acc-line)",
            background: "var(--acc-dim)",
            boxShadow: "var(--acc-glow)",
          }}
        >
          <div
            style={{
              width: 62,
              height: 62,
              borderRadius: "50%",
              background:
                "radial-gradient(circle at 38% 32%, #2d93ff 0%, var(--acc) 46%, var(--acc-2) 100%)",
              border: "3px solid var(--tile)",
              boxShadow: "inset 0 2px 6px rgba(255,255,255,.35), 0 4px 12px -3px rgba(0,0,0,.7)",
            }}
          />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.02em" }}>Photo booth</div>
          <div className="cap" style={{ marginTop: 8 }}>
            press the shutter
          </div>
        </div>
      </div>
    </Tile>
  );
}
