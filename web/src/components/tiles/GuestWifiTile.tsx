import { closeGuestWifiModal, useGuestWifiModalOpen } from "@/lib/guest-wifi-modal-store";
import { trpc } from "@/lib/trpc";
import { GuestWifiTileView } from "./GuestWifiTileView";
import { GuestWifiQrModal } from "./views/GuestWifiQrModal";

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
