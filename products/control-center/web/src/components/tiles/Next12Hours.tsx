import { TileStatus } from "@/components/ui";
import { POLL } from "@/lib/hooks";
import { trpc } from "@/lib/trpc";
import { useTileQuery } from "@/lib/useTileQuery";
import { Next12HoursView } from "./Next12HoursView";

export function Next12Hours() {
  const q = useTileQuery(
    trpc.weather.hourly.useQuery(undefined, {
      refetchInterval: POLL.weather,
    }),
  );

  if (q.status !== TileStatus.Populated) return <Next12HoursView status={q.status} />;

  // The shared weather.hourly endpoint now returns 24 slots (the detail modals
  // need a full day); this tile is the *next 12 hours* strip, so cap it at 12.
  // An empty array still resolves as populated; the view renders its skeleton
  // when there are no hours, so an empty fetch shows the skeleton either way.
  return <Next12HoursView status={q.status} hours={q.data.slice(0, 12)} />;
}
