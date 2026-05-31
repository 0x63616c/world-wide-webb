import { POLL } from "@/lib/hooks";
import { trpc } from "@/lib/trpc";
import { TileStatus } from "./EventsTileView";
import { TeslaTileView } from "./TeslaTileView";

export function TeslaTile() {
  const { data, isError } = trpc.tesla.get.useQuery(undefined, {
    refetchInterval: POLL.tesla,
  });

  if (!data) return <TeslaTileView status={isError ? TileStatus.Error : TileStatus.Loading} />;

  return (
    <TeslaTileView
      status={TileStatus.Populated}
      locked={data.locked}
      charging={data.charging}
      rate={data.rate}
      pct={data.pct}
      range={data.range}
      odo={data.odo}
      climate={data.climate}
      lat={data.lat ?? null}
      lon={data.lon ?? null}
      place={data.place ?? ""}
    />
  );
}
