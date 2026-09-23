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
  onQrClick: () => void;
}

// Keep the QR body at this inset: a 2x2 tile is ~207px square, and at 12 the
// code remains scannable. Inset the header to match the other tiles without
// adding horizontal padding around the QR body.
const TILE_PADDING = 12;

export function WifiTileView({ status, qr, onQrClick }: WifiTileViewProps) {
  return (
    <Tile padding={TILE_PADDING}>
      <div style={{ marginInline: 10, marginTop: 10 }}>
        <TileHeader icon="wifi" title="Wi-Fi" />
      </div>
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
          <button
            type="button"
            aria-label="Enlarge Wi-Fi QR code"
            onClick={onQrClick}
            style={{ height: "100%", padding: 0, border: 0, background: "none", cursor: "zoom-in" }}
          >
            <WifiQr value={qr} />
          </button>
        ) : (
          <span style={{ fontSize: 13, color: "var(--ink-3)", textAlign: "center" }}>
            Guest network not configured
          </span>
        )}
      </div>
    </Tile>
  );
}
