import { POLL } from "../../lib/hooks";
import { trpc } from "../../lib/trpc";
import { Next12HoursView } from "./Next12HoursView";

export function Next12Hours() {
  const { data } = trpc.weather.hourly.useQuery(undefined, {
    refetchInterval: POLL.weather,
  });

  if (!data || data.length === 0) return <Next12HoursView status="loading" />;

  // The shared weather.hourly endpoint now returns 24 slots (the detail modals
  // need a full day); this tile is the *next 12 hours* strip, so cap it at 12.
  return <Next12HoursView status="populated" hours={data.slice(0, 12)} />;
}
