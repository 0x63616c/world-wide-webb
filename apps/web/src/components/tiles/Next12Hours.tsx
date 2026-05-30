import { POLL } from "../../lib/hooks";
import { trpc } from "../../lib/trpc";
import { Next12HoursView } from "./Next12HoursView";

export function Next12Hours() {
  const { data } = trpc.weather.hourly.useQuery(undefined, {
    refetchInterval: POLL.weather,
  });

  if (!data || data.length === 0) return <Next12HoursView status="loading" />;

  return <Next12HoursView status="populated" hours={data} />;
}
