import { POLL } from "../../lib/hooks";
import { trpc } from "../../lib/trpc";
import { EventsTileView } from "./EventsTileView";

export function EventsTile() {
  const { data, isLoading, isError } = trpc.events.list.useQuery(undefined, {
    refetchInterval: POLL.events,
  });

  const status = isLoading ? "loading" : isError ? "error" : "populated";

  return <EventsTileView status={status} events={data ?? []} />;
}
