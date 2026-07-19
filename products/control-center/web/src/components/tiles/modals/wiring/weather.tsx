/**
 * Weather tile (tile_weath) , live wiring for its detail-page variants.
 *
 * Data sources (all live, from the tRPC weather router):
 *  - trpc.weather.now    → temp/feels/hum/wind/cond/ic/uvIndex/precipProbability,
 *                          solar ISO times, today's hi/lo, city
 *  - trpc.weather.hourly → 24-slot hourly forecast (temp/feels/ic/isDay/...)
 *  - trpc.weather.daily  → 7-day outlook (hi/lo/weatherCode/precipProbability)
 *  - client wall clock (useNow) → nowMs for the sun-arc animation
 *
 * Pure page-body views receive adapted live props; this module owns the mapping.
 */

import type { DetailVariant, TileDetailPageEntry } from "@/components/tiles/detail/types";
import type { ComfortBreakdownData } from "@/components/tiles/modals/WeatherModalComfortBreakdown";
import { WeatherModalComfortBreakdown } from "@/components/tiles/modals/WeatherModalComfortBreakdown";
import type { HourlySlot } from "@/components/tiles/modals/WeatherModalHourlyTempCurve";
import { WeatherModalHourlyTempCurve } from "@/components/tiles/modals/WeatherModalHourlyTempCurve";
import { WeatherModalSunDayArc } from "@/components/tiles/modals/WeatherModalSunDayArc";
import type { DayForecast } from "@/components/tiles/modals/WeatherModalWeekOutlook";
import { WeatherModalWeekOutlook } from "@/components/tiles/modals/WeatherModalWeekOutlook";
import { POLL, useNow } from "@/lib/hooks";
import { trpc } from "@/lib/trpc";

const REFETCH = { refetchInterval: POLL.weather } as const;

function useWeatherVariants(): { variants: DetailVariant[]; loading: boolean } {
  const now = useNow();
  const weather = trpc.weather.now.useQuery(undefined, REFETCH);
  const hourly = trpc.weather.hourly.useQuery(undefined, REFETCH);
  const daily = trpc.weather.daily.useQuery(undefined, REFETCH);

  const w = weather.data;
  const h = hourly.data;
  const d = daily.data;
  // Hold the full variant list until all three queries resolve so the switcher
  // is stable and no variant renders with missing live data.
  if (!w || !h || !d) return { variants: [], loading: true };

  const comfort: ComfortBreakdownData = {
    temp: w.temp,
    feels: w.feels,
    hum: w.hum,
    wind: w.wind,
    cond: w.cond,
    uvIndex: w.uvIndex,
    precipProbability: w.precipProbability,
  };

  const slots: HourlySlot[] = h.map((s) => ({
    t: s.t,
    temp: s.temp,
    feels: s.feels,
    ic: s.ic,
    isDay: s.isDay,
  }));

  const days: DayForecast[] = d.map((day) => ({
    date: day.date,
    hi: day.hi,
    lo: day.lo,
    weatherCode: day.weatherCode,
    precipProbability: day.precipProbability,
  }));

  const variants: DetailVariant[] = [
    {
      slug: "hourly-temp-curve",
      label: "Hourly Curve",
      render: () => (
        <WeatherModalHourlyTempCurve
          slots={slots}
          currentTemp={w.temp}
          currentFeels={w.feels}
          dailyHi={w.hi}
          dailyLo={w.lo}
        />
      ),
    },
    {
      slug: "comfort-breakdown",
      label: "Comfort",
      render: () => <WeatherModalComfortBreakdown data={comfort} />,
    },
    {
      slug: "sun-day-arc",
      label: "Sun Arc",
      render: () => (
        <WeatherModalSunDayArc
          sunriseIso={w.sunriseIso}
          sunsetIso={w.sunsetIso}
          tomorrowSunriseIso={w.tomorrowSunriseIso}
          nowMs={now.getTime()}
        />
      ),
    },
    {
      slug: "week-outlook",
      label: "Week",
      render: () => <WeatherModalWeekOutlook todayHi={w.hi} todayLo={w.lo} days={days} />,
    },
  ];

  return { variants, loading: false };
}

export const weatherDetailEntry: TileDetailPageEntry = {
  kind: "page",
  tileId: "tile_weath",
  title: "Weather Now",
  defaultSlug: "hourly-temp-curve",
  useVariants: useWeatherVariants,
};
