/**
 * Themed QR code renderer for the guest Wi-Fi tile (www guest network).
 *
 * Pure presentational SVG: `uqr` encodes the WIFI: payload into a module
 * matrix and this component draws it in the board's grayscale/accent language.
 *
 * Styles:
 * - "crisp":   square dark modules on a light card , the conservative classic.
 * - "rounded": dot-softened dark modules on a light card.
 * - "accent":  INVERTED , light modules on the dark tile surface with accent
 *              finder corners. Modern phone cameras decode inverted codes.
 * - "apple":   inverted circular-dot grid with drawn finder rings (App-Clip-ish).
 * - "inverted": plain inversion , light modules on dark, no accent, no glow.
 */

import { encode } from "uqr";

export type GuestWifiQrStyle = "crisp" | "rounded" | "accent" | "apple" | "inverted";

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

/** Top-left module coordinate of each finder square. */
function finderOrigins(count: number): [number, number][] {
  return [
    [BORDER, BORDER],
    [count - BORDER - FINDER, BORDER],
    [BORDER, count - BORDER - FINDER],
  ];
}

export function GuestWifiQr({ value, size, qrStyle = "rounded" }: GuestWifiQrProps) {
  const qr = encode(value, { border: BORDER, ecc: "M" });
  const count = qr.size;
  const cell = size / count;

  const inverted = qrStyle === "accent" || qrStyle === "apple" || qrStyle === "inverted";
  // Accent finders + glow only on the deliberately-decorated styles.
  const decorated = qrStyle === "accent" || qrStyle === "apple";
  const drawnFinders = qrStyle === "apple";
  const moduleColor = inverted ? "#ededed" : "#0a0a0a";
  const finderColor = decorated ? "var(--acc)" : moduleColor;

  const data: { x: number; y: number; finder: boolean }[] = [];
  for (let y = 0; y < count; y++) {
    for (let x = 0; x < count; x++) {
      if (!qr.data[y]?.[x]) continue;
      const finder = isInFinder(x, y, count);
      // "apple" replaces the raw finder modules with drawn rings below.
      if (finder && drawnFinders) continue;
      data.push({ x, y, finder });
    }
  }

  return (
    <div
      aria-label="Guest Wi-Fi QR code"
      role="img"
      style={{
        width: size,
        height: size,
        flex: "0 0 auto",
        borderRadius: 16,
        // Light card for the classic styles; the inverted styles sit on a
        // near-black card so the code melts into the board's theme.
        background: inverted ? "#050505" : "#ededed",
        padding: Math.round(size * 0.045),
        boxShadow: decorated
          ? "var(--acc-glow)"
          : "inset 0 1px 0 0 rgba(255,255,255,0.4), 0 10px 30px -18px rgba(0,0,0,0.8)",
        border: decorated ? "1px solid var(--acc-line)" : "1px solid var(--hair-2)",
      }}
    >
      <svg viewBox={`0 0 ${size} ${size}`} width="100%" height="100%" aria-hidden="true">
        {data.map((m) => {
          if (qrStyle === "apple") {
            // Pure circular dots, slightly shrunk so the grid breathes.
            return (
              <circle
                key={`${m.x}-${m.y}`}
                cx={(m.x + 0.5) * cell}
                cy={(m.y + 0.5) * cell}
                r={cell * 0.38}
                fill={moduleColor}
              />
            );
          }
          const rounded = qrStyle !== "crisp";
          const r = rounded ? (m.finder ? cell * 0.32 : cell * 0.5) : 0;
          // Rounded data modules shrink a hair so they read as dots, not a
          // blob; finder squares stay contiguous so scanners lock on.
          const inset = rounded && !m.finder ? cell * 0.06 : 0;
          return (
            <rect
              key={`${m.x}-${m.y}`}
              x={m.x * cell + inset}
              y={m.y * cell + inset}
              width={cell - inset * 2}
              height={cell - inset * 2}
              rx={r}
              fill={m.finder ? finderColor : moduleColor}
            />
          );
        })}
        {drawnFinders &&
          finderOrigins(count).map(([fx, fy]) => {
            const o = fx * cell;
            const t = fy * cell;
            const s = FINDER * cell;
            return (
              <g key={`${fx}-${fy}`}>
                {/* Outer ring: 1-module-thick rounded square stroke. */}
                <rect
                  x={o + cell * 0.5}
                  y={t + cell * 0.5}
                  width={s - cell}
                  height={s - cell}
                  rx={cell * 1.8}
                  fill="none"
                  stroke={moduleColor}
                  strokeWidth={cell}
                />
                {/* Inner 3x3 pupil, accent-tinted. */}
                <rect
                  x={o + cell * 2}
                  y={t + cell * 2}
                  width={cell * 3}
                  height={cell * 3}
                  rx={cell * 1.1}
                  fill={finderColor}
                />
              </g>
            );
          })}
      </svg>
    </div>
  );
}
