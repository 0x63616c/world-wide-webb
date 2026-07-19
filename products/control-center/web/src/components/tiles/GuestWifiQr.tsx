/**
 * Themed QR code renderer for the guest Wi-Fi tile (www guest network).
 *
 * Pure presentational SVG: `uqr` encodes the WIFI: payload into a module
 * matrix and this component draws it in the board's grayscale/accent language.
 * The modules are always DARK on a LIGHT card , phone cameras reliably decode
 * dark-on-light only, so the "theming" happens in the card, corners and glow,
 * never by inverting the code itself.
 */

import { encode } from "uqr";

export type GuestWifiQrStyle = "crisp" | "rounded" | "accent";

interface GuestWifiQrProps {
  /** Full payload, e.g. "WIFI:T:WPA;S:<ssid>;P:<password>;;". */
  value: string;
  /** Rendered square size in px. */
  size: number;
  qrStyle?: GuestWifiQrStyle;
}

// Quiet-zone border in modules. 2 is the practical minimum for camera decode.
const BORDER = 2;
// The three 7x7 finder squares sit at these data-coordinate corners.
const FINDER = 7;

function isInFinder(x: number, y: number, count: number): boolean {
  const inLeft = x < FINDER + BORDER && x >= BORDER;
  const inRight = x >= count - FINDER - BORDER && x < count - BORDER;
  const inTop = y < FINDER + BORDER && y >= BORDER;
  const inBottom = y >= count - FINDER - BORDER && y < count - BORDER;
  return (inTop && (inLeft || inRight)) || (inBottom && inLeft);
}

export function GuestWifiQr({ value, size, qrStyle = "rounded" }: GuestWifiQrProps) {
  const qr = encode(value, { border: BORDER, ecc: "M" });
  const count = qr.size;
  const cell = size / count;

  const rounded = qrStyle !== "crisp";
  const accent = qrStyle === "accent";
  const moduleColor = "#0a0a0a";
  const finderColor = accent ? "var(--acc)" : moduleColor;

  const rects: { x: number; y: number; r: number; inset: number; finder: boolean }[] = [];
  for (let y = 0; y < count; y++) {
    for (let x = 0; x < count; x++) {
      if (!qr.data[y]?.[x]) continue;
      const finder = isInFinder(x, y, count);
      rects.push({
        x,
        y,
        finder,
        r: rounded ? (finder ? cell * 0.32 : cell * 0.5) : 0,
        // Rounded data modules shrink a hair so they read as dots, not a blob;
        // finder squares stay contiguous so scanners lock on.
        inset: rounded && !finder ? cell * 0.06 : 0,
      });
    }
  }

  return (
    <div
      aria-label="Guest Wi-Fi QR code"
      role="img"
      style={{
        width: size,
        height: size,
        borderRadius: 16,
        // Light card so the dark modules decode; grayscale keeps it on-theme.
        background: "#ededed",
        padding: Math.round(size * 0.045),
        boxShadow: accent
          ? "var(--acc-glow)"
          : "inset 0 1px 0 0 rgba(255,255,255,0.4), 0 10px 30px -18px rgba(0,0,0,0.8)",
        border: accent ? "1px solid var(--acc-line)" : "1px solid var(--hair-2)",
      }}
    >
      <svg viewBox={`0 0 ${size} ${size}`} width="100%" height="100%" aria-hidden="true">
        {rects.map((m) => (
          <rect
            key={`${m.x}-${m.y}`}
            x={m.x * cell + m.inset}
            y={m.y * cell + m.inset}
            width={cell - m.inset * 2}
            height={cell - m.inset * 2}
            rx={m.r}
            fill={m.finder ? finderColor : moduleColor}
          />
        ))}
      </svg>
    </div>
  );
}
