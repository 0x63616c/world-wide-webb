import { Icon } from "@/components/Icon";
import { GuestWifiQrModal } from "@/components/tiles/views/GuestWifiQrModal";
import { Tile, TileHeader, type TileStatus } from "@/components/ui";
import { trpc } from "@/lib/trpc";
import { closeGuestWifiModal, useGuestWifiModalOpen } from "./modal-store";

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
      {/* Title MUST stay in sync with the manifest label in ./manifest.ts. */}
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

/**
 * Thin container for the Guest Wi-Fi tile. Tapping the tile runs the detail
 * registry's ACTION entry (detail/wiring/guest-wifi.tsx), which flips the
 * guest-wifi-modal-store flag; this always-mounted container subscribes and
 * renders the small QR modal , the one tile whose detail is deliberately a
 * modal, not a full page.
 *
 * The QR payload query only runs while the modal is open, so the guest
 * credentials are not fetched (or held in the query cache) until someone
 * actually asks for the code. The face itself needs no data.
 */
export function GuestWifiTile() {
  const open = useGuestWifiModalOpen();
  const qr = trpc.network.guestWifiQr.useQuery(undefined, { enabled: open });

  return (
    <>
      <GuestWifiTileView status="populated" />
      {open && qr.data?.qr ? (
        <GuestWifiQrModal open onClose={closeGuestWifiModal} qrValue={qr.data.qr} />
      ) : null}
    </>
  );
}
