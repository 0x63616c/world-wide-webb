import { trpc } from "../../lib/trpc";
import { NetworkTileView } from "./NetworkTileView";

export function NetworkTile() {
  const { data } = trpc.network.status.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  if (!data) return <NetworkTileView status="loading" />;

  return (
    <NetworkTileView
      status="populated"
      isOffline={data.status === "Offline"}
      down={data.down}
      up={data.up}
      ssid={data.ssid}
      ping={data.ping}
      traffic={data.traffic}
    />
  );
}
