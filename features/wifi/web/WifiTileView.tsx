/**
 * WifiTileView — pure presentational face for the Wi-Fi tile: a titled 2x2
 * tile whose body is the guest-network QR code, drawn directly on the tile
 * surface. All data arrives as props; no trpc or hooks inside.
 *
 * The title MUST stay in sync with the manifest label.
 */
import { Skeleton, Tile, TileHeader, TileStatus } from "@/components/ui";
import { WifiQr } from "./WifiQr";

export interface WifiTileViewProps {
  status: TileStatus;
  /** WIFI: join payload; "" when the guest network is not configured. */
  qr: string;
}

// Tighter than the 20–22 the larger tiles use: a 2x2 tile is ~207px square,
// and every pixel the chrome gives up goes to QR module size (scannability).
const TILE_PADDING = 16;

export function WifiTileView({ status, qr }: WifiTileViewProps) {
  return (
    <Tile padding={TILE_PADDING}>
      <TileHeader icon="wifi" title="Wi-Fi" />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {status !== TileStatus.Populated ? (
          // Loading and error both shimmer; the query retries on its own.
          <Skeleton w="100%" h="100%" borderRadius={12} />
        ) : qr ? (
          <WifiQr value={qr} />
        ) : (
          <span style={{ fontSize: 13, color: "var(--ink-3)", textAlign: "center" }}>
            Guest network not configured
          </span>
        )}
      </div>
    </Tile>
  );
}
