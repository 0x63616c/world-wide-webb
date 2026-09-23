import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { trpc } from "@/lib/trpc";
import { useTileQuery } from "@/lib/useTileQuery";
import { WifiQr } from "./WifiQr";
import { WifiTileView } from "./WifiTileView";

/**
 * Thin container for the Wi-Fi tile face: fetches the guest-network join
 * payload once (credentials don't change at runtime) and hands it to the view.
 */
export function WifiTile() {
  const [qrOpen, setQrOpen] = useState(false);
  const query = trpc.wifi.guestQr.useQuery(undefined, { staleTime: Number.POSITIVE_INFINITY });
  const { status } = useTileQuery(query);
  const qr = query.data?.qr ?? "";
  return (
    <>
      <WifiTileView status={status} qr={qr} onQrClick={() => setQrOpen(true)} />
      <Modal
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        title="Wi-Fi"
        width={900}
        maxHeight={900}
      >
        <div style={{ height: 740, display: "flex", justifyContent: "center" }}>
          <WifiQr value={qr} />
        </div>
      </Modal>
    </>
  );
}
