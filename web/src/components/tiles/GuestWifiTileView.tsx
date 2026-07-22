import { Icon } from "@/components/Icon";
import { Tile, TileHeader, type TileStatus } from "@/components/ui";

export interface GuestWifiTileViewProps {
  status: TileStatus;
}

/**
 * Guest Wi-Fi tile face , the "ghost corner" treatment (design pick
 * 2026-07-19): a large ghosted QR glyph bleeding off the bottom-right corner
 * gives the tile texture without noise, one quiet cap line carries the
 * affordance. Deliberately shows NOTHING real: the guest SSID/password exist
 * only inside the QR in the tap modal, never on the board face.
 */
export function GuestWifiTileView({ status }: GuestWifiTileViewProps) {
  const isLoading = status !== "populated";

  return (
    <Tile padding={18} style={{ overflow: "hidden" }}>
      {/* Title MUST stay in sync with the registry label in lib/tile-registry.ts. */}
      <TileHeader icon="wifi" title="Guest" iconSize={16} titleSize={15} />
      <div style={{ position: "absolute", right: -14, bottom: -14, opacity: 0.16 }}>
        <Icon name="qr-code" s={110} c="var(--ink-2)" />
      </div>
      <div className="cap" style={{ marginTop: "auto", opacity: isLoading ? 0.4 : 1 }}>
        tap to share
      </div>
    </Tile>
  );
}
