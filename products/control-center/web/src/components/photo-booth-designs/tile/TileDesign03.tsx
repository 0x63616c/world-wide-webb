import { Tile, TileHeader } from "@/components/ui";

/**
 * Design 03 , "Polaroid Stack" (4x3).
 * A fanned stack of instant-photos teases the last few shots. The "photos" are
 * obviously decorative procedural gradients (no real imagery), and the white
 * frames pop against the dark board. Reads as a physical pile you can add to.
 */

// Decorative-only gradient "photos" , clearly abstract, generated in-code.
const FRAMES: Array<{ rotate: number; x: number; grad: string }> = [
  { rotate: -9, x: -46, grad: "linear-gradient(150deg, #ff9d6c 0%, #bb4e75 100%)" },
  { rotate: 6, x: 0, grad: "linear-gradient(150deg, #3a7bd5 0%, #00d2c6 100%)" },
  { rotate: 15, x: 46, grad: "linear-gradient(150deg, #b06ab3 0%, #4568dc 100%)" },
];

export function TileDesign03() {
  return (
    <Tile padding={18} style={{ overflow: "hidden" }}>
      <TileHeader
        icon="cam"
        title="Photo booth"
        iconSize={17}
        titleSize={16}
        right={
          <span className="pill on" style={{ fontSize: 11.5 }}>
            +3 today
          </span>
        }
      />
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {FRAMES.map((f) => (
          <div
            key={f.rotate}
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              width: 108,
              transform: `translate(calc(-50% + ${f.x}px), -50%) rotate(${f.rotate}deg)`,
              background: "#f4f4f2",
              padding: "7px 7px 22px",
              borderRadius: 3,
              boxShadow: "0 10px 24px -8px rgba(0,0,0,.75)",
            }}
          >
            <div style={{ height: 96, borderRadius: 2, background: f.grad }} />
          </div>
        ))}
      </div>
      <div className="cap" style={{ marginTop: 12 }}>
        tap to add a shot
      </div>
    </Tile>
  );
}

export const PhotoBoothPolaroidStack = TileDesign03;
