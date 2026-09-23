/**
 * WifiQr — the guest-network QR code drawn straight onto the tile.
 *
 * Pure presentational SVG: `uqr` encodes the WIFI: payload into a module
 * matrix and this draws it in the board's own ink on the tile's own surface.
 * There is deliberately NO background of its own — the quiet zone and the
 * gaps between modules are the tile background (`--tile`) showing through,
 * so the code reads as part of the tile rather than a white card punched
 * into the dark theme, and a phone scans it where it sits. Light modules on
 * a dark ground is an inverted code, which current phone cameras decode.
 *
 * Sizing: the SVG fills the square its parent gives it (height-bound in the
 * tile body, width 100% via aspect-ratio), and the viewBox is in module
 * units so every module lands on the same fractional pixel pitch.
 */

import { encode } from "uqr";

interface WifiQrProps {
  /** Full payload, e.g. "WIFI:T:WPA;S:<ssid>;P:<password>;;". */
  value: string;
}

// Quiet-zone border in modules. 2 is the practical minimum for camera decode;
// the tile padding around the body adds more tile-colored margin on top.
const BORDER = 2;

export function WifiQr({ value }: WifiQrProps) {
  const qr = encode(value, { border: BORDER, ecc: "M" });
  const count = qr.size;

  const cells: string[] = [];
  for (let y = 0; y < count; y++) {
    for (let x = 0; x < count; x++) {
      if (qr.data[y]?.[x]) cells.push(`M${x} ${y}h1v1h-1z`);
    }
  }

  return (
    <svg
      role="img"
      aria-label="Guest Wi-Fi QR code"
      viewBox={`0 0 ${count} ${count}`}
      style={{ height: "100%", aspectRatio: "1 / 1", display: "block" }}
      shapeRendering="crispEdges"
    >
      <path d={cells.join("")} fill="var(--ink)" />
    </svg>
  );
}
