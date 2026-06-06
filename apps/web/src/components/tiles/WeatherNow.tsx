import { trpc } from "../../lib/trpc";
import { WeatherNowView } from "./WeatherNowView";

export function WeatherNow() {
  const { data, isError } = trpc.weather.now.useQuery(undefined, {
    refetchInterval: 10 * 60 * 1000, // 10 minutes
    retry: 2,
  });

  if (!data || isError) {
    return <WeatherNowView status={isError ? "error" : "loading"} />;
  }

  // solarLabel/solarValue are computed server-side (CC-355t.24); no client logic needed.
  return (
    <WeatherNowView
      status="populated"
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
