import { TileStatus } from "@/components/ui";
import { POLL } from "@/lib/hooks";
import { trpc } from "@/lib/trpc";
import { useTileQuery } from "@/lib/useTileQuery";
import { WeatherNowView } from "./WeatherNowView";

export function WeatherNow() {
  const q = useTileQuery(
    trpc.weather.now.useQuery(undefined, {
      refetchInterval: POLL.weather,
      retry: 2,
    }),
  );

  if (q.status !== TileStatus.Populated) return <WeatherNowView status={q.status} />;

  // solarLabel/solarValue are computed server-side (www-355t.24); no client logic needed.
  const data = q.data;
  return (
    <WeatherNowView
      status={q.status}
      temp={String(Math.round(data.temp))}
      cond={data.cond}
      hi={String(Math.round(data.hi))}
      lo={String(Math.round(data.lo))}
      feels={String(Math.round(data.feels))}
      hum={String(data.hum)}
      wind={String(Math.round(data.wind))}
      city={data.city}
      solarLabel={data.solarLabel}
      solarValue={data.solarValue}
    />
  );
}
