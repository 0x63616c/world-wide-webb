import { Icon } from "@/components/Icon";
import { Skeleton, Tile, TileHeader, type TileStatus } from "@/components/ui";

/**
 * Face treatments under consideration (design round, 2026-07-19):
 * - "badge": QR glyph in a nest card + "scan to join" cap , quietest option.
 * - "mini-qr": decorative faux QR texture on the face. NOT the real code (the
 *   guest SSID must never be derivable from the board face), purely a tease.
 * - "beacon": big wifi glyph with the live pulse dot, no QR reference at all.
 */
export type GuestWifiFaceVariant = "badge" | "mini-qr" | "beacon";

export interface GuestWifiTileViewProps {
  status: TileStatus;
  variant?: GuestWifiFaceVariant;
}

/**
 * Deterministic decorative texture for the "mini-qr" face. Hand-rolled bit
 * pattern (NOT an encoding of anything) so nothing sensitive is on the face.
 */
function FauxQr({ size }: { size: number }) {
  const n = 9;
  const cell = size / n;
  // Fixed pattern; corner squares mimic finders so it reads as "a QR".
  const bits = [
    0b111010111, 0b101011101, 0b111000111, 0b000110100, 0b010101011, 0b001011010, 0b111001101,
    0b101010010, 0b111011011,
  ];
  const rects = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (((bits[y] ?? 0) >> (n - 1 - x)) & 1) {
        rects.push(
          <rect
            key={`${x}-${y}`}
            x={x * cell + cell * 0.08}
            y={y * cell + cell * 0.08}
            width={cell * 0.84}
            height={cell * 0.84}
            rx={cell * 0.28}
          />,
        );
      }
    }
  }
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
      <g fill="var(--ink-3)">{rects}</g>
    </svg>
  );
}

export function GuestWifiTileView({ status, variant = "badge" }: GuestWifiTileViewProps) {
  const isLoading = status !== "populated";

  return (
    <Tile padding={18}>
      {/* Title MUST stay in sync with the registry label in lib/tile-registry.ts. */}
      <TileHeader icon="wifi" title="Guest" iconSize={16} titleSize={15} />
      {isLoading ? (
        <div style={{ marginTop: "auto" }}>
          <Skeleton w={64} h={40} />
        </div>
      ) : variant === "badge" ? (
        <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: "var(--nest)",
              border: "1px solid var(--hair)",
              display: "grid",
              placeItems: "center",
              color: "var(--ink-2)",
            }}
          >
            <Icon name="qr-code" s={22} c="var(--ink-2)" />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Wi-Fi pass</div>
            <div className="cap" style={{ marginTop: 3 }}>
              tap for QR
            </div>
          </div>
        </div>
      ) : variant === "mini-qr" ? (
        <div
          style={{
            marginTop: "auto",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div className="cap">scan to join</div>
          <FauxQr size={54} />
        </div>
      ) : (
        <div
          style={{
            marginTop: "auto",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
            paddingBottom: 6,
          }}
        >
          <div style={{ position: "relative", display: "grid", placeItems: "center" }}>
            <Icon name="wifi" s={40} c="var(--ink)" />
            <span className="dot" style={{ position: "absolute", right: -10, top: 0 }} />
          </div>
          <div className="cap">guest access</div>
        </div>
      )}
    </Tile>
  );
}
