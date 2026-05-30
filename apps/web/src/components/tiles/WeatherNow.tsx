import { trpc } from "../../lib/trpc";
import { WeatherNowView } from "./WeatherNowView";

// Format an ISO local datetime "2024-06-01T19:52" as "h:mm AM/PM"
function formatIsoTime(iso: string): string {
  const parts = iso.match(/T(\d+):(\d+)/);
  if (!parts) return iso;
  let h = parseInt(parts[1], 10);
  const m = parts[2];
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

// Parse "2024-06-01T19:52" to a Date treating the string as local wall-clock time.
// Open-Meteo returns local datetime strings without a timezone suffix.
function isoLocalToDate(iso: string): Date {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return new Date(0);
  return new Date(
    parseInt(m[1], 10),
    parseInt(m[2], 10) - 1,
    parseInt(m[3], 10),
    parseInt(m[4], 10),
    parseInt(m[5], 10),
  );
}

// Determine which solar event to show: Sunset before it occurs, then Sunrise after.
// Uses full calendar-aware comparison so night hours are correctly classified.
function nextSolarEvent(
  now: Date,
  sunsetIso: string,
  tomorrowSunriseIso: string,
): { label: string; value: string } {
  const sunsetDate = isoLocalToDate(sunsetIso);
  const tomorrowSunriseDate = isoLocalToDate(tomorrowSunriseIso);

  if (now < sunsetDate) {
    return { label: "Sunset", value: formatIsoTime(sunsetIso) };
  }

  if (now < tomorrowSunriseDate) {
    return { label: "Sunrise", value: formatIsoTime(tomorrowSunriseIso) };
  }

  // Past tomorrow's sunrise — next sunset is the upcoming one for the day
  return { label: "Sunset", value: formatIsoTime(sunsetIso) };
}

export function WeatherNow() {
  const { data, isError } = trpc.weather.now.useQuery(undefined, {
    refetchInterval: 10 * 60 * 1000, // 10 minutes
    retry: 2,
  });

  if (!data || isError) {
    return <WeatherNowView status={isError ? "error" : "loading"} />;
  }

  const solarEvent = nextSolarEvent(new Date(), data.sunsetIso, data.tomorrowSunriseIso);

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
      solarLabel={solarEvent.label}
      solarValue={solarEvent.value}
    />
  );
}
