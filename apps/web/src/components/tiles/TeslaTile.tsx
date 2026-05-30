import { POLL } from "@/lib/hooks";
import { trpc } from "@/lib/trpc";
import { TeslaTileView } from "./TeslaTileView";

export function TeslaTile() {
  const { data, isError } = trpc.tesla.get.useQuery(undefined, {
    refetchInterval: POLL.tesla,
  });

  if (!data) return <TeslaTileView status={isError ? "error" : "loading"} />;

  return (
    <TeslaTileView
      status="populated"
      locked={data.locked}
      charging={data.charging}
      rate={data.rate}
      pct={data.pct}
      range={data.range}
      odo={data.odo}
      climate={data.climate}
    />
  );
}
