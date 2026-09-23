import { trpc } from "@/lib/trpc";
import { useTileQuery } from "@/lib/useTileQuery";
import { WifiTileView } from "./WifiTileView";

/**
 * Thin container for the Wi-Fi tile face: fetches the guest-network join
 * payload once (credentials don't change at runtime) and hands it to the view.
 */
export function WifiTile() {
  const query = trpc.wifi.guestQr.useQuery(undefined, { staleTime: Number.POSITIVE_INFINITY });
  const { status } = useTileQuery(query);
  return <WifiTileView status={status} qr={query.data?.qr ?? ""} />;
}
