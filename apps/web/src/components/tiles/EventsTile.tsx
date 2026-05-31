import { POLL } from "../../lib/hooks";
import { trpc } from "../../lib/trpc";
import { EventsTileView, TileStatus } from "./EventsTileView";

export function EventsTile() {
  const { data, isLoading, isError } = trpc.events.list.useQuery(undefined, {
    refetchInterval: POLL.events,
  });

  const status = isLoading ? TileStatus.Loading : isError ? TileStatus.Error : TileStatus.Populated;

  return <EventsTileView status={status} events={data ?? []} />;
}
