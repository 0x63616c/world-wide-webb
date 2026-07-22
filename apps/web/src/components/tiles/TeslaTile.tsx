import { TileStatus } from "@/components/ui";
import { POLL } from "@/lib/hooks";
import { trpc } from "@/lib/trpc";
import { useTileQuery } from "@/lib/useTileQuery";
import { TeslaTileView } from "./TeslaTileView";

export function TeslaTile() {
  const q = useTileQuery(
    trpc.tesla.get.useQuery(undefined, {
      refetchInterval: POLL.tesla,
    }),
  );

  if (q.status !== TileStatus.Populated) return <TeslaTileView status={q.status} />;

  const data = q.data;
  return (
    <TeslaTileView
      status={q.status}
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
