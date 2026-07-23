import { TileStatus } from "@/components/ui";
import { POLL } from "@/lib/hooks";
import { trpc } from "@/lib/trpc";
import { useTileQuery } from "@/lib/useTileQuery";
import { NetworkTileView } from "./NetworkTileView";

export { NetworkTileView } from "./NetworkTileView";

export function NetworkTile() {
  const q = useTileQuery(
    trpc.network.status.useQuery(undefined, {
      refetchInterval: POLL.network,
    }),
  );

  if (q.status !== TileStatus.Populated) return <NetworkTileView status={q.status} />;

  const data = q.data;
  return (
    <NetworkTileView
      status={q.status}
      isOffline={data.status === "Offline"}
      down={data.down}
      up={data.up}
      ssid={data.ssid}
      ping={data.ping}
      traffic={data.traffic}
    />
  );
}
