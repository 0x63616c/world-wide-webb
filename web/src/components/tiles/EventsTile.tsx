import { POLL } from "@/lib/hooks";
import { trpc } from "@/lib/trpc";
import { useTileQuery } from "@/lib/useTileQuery";
import { EventsTileView } from "./EventsTileView";

export function EventsTile() {
  const q = useTileQuery(
    trpc.events.list.useQuery(undefined, {
      refetchInterval: POLL.events,
    }),
  );

  return <EventsTileView status={q.status} events={q.data ?? []} />;
}
