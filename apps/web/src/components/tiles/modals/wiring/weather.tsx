/**
 * Weather tile (tile_weath) — live wiring for its detail-modal variants.
 *
 * Data sources (all live, from the tRPC weather router):
 *  - trpc.weather.now    → temp/feels/hum/wind/cond/ic/uvIndex/precipProbability,
 *                          solar ISO times, today's hi/lo, city
 *  - trpc.weather.hourly → 24-slot hourly forecast (temp/feels/ic/isDay/...)
 *  - trpc.weather.daily  → 7-day outlook (hi/lo/weatherCode/precipProbability)
 *  - client wall clock (useNow) → nowMs for the sun-arc animation
 *
 * Pure modal views receive adapted live props; this module owns the mapping.
 */

import { trpc } from "../../../../lib/trpc";
import type { LiveVariant, TileModalEntry } from "../types";
import type { ComfortBreakdownData } from "../WeatherModalComfortBreakdown";
import { WeatherModalComfortBreakdown } from "../WeatherModalComfortBreakdown";
import type { HourlySlot } from "../WeatherModalHourlyTempCurve";
import { WeatherModalHourlyTempCurve } from "../WeatherModalHourlyTempCurve";
import { WeatherModalSunDayArc } from "../WeatherModalSunDayArc";
import type { DayForecast } from "../WeatherModalWeekOutlook";
import { WeatherModalWeekOutlook } from "../WeatherModalWeekOutlook";
import { useNow } from "./use-now";

const REFETCH = { refetchInterval: 10 * 60 * 1000 } as const;

function useWeatherVariants(): { variants: LiveVariant[]; loading: boolean } {
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

  const variants: LiveVariant[] = [
    {
      slug: "hourly-temp-curve",
      label: "Hourly Curve",
      render: (open, onClose) => (
        <WeatherModalHourlyTempCurve
          open={open}
          onClose={onClose}
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
      render: (open, onClose) => (
        <WeatherModalComfortBreakdown open={open} onClose={onClose} data={comfort} />
      ),
    },
    {
      slug: "sun-day-arc",
      label: "Sun Arc",
      render: (open, onClose) => (
        <WeatherModalSunDayArc
          open={open}
          onClose={onClose}
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
      render: (open, onClose) => (
        <WeatherModalWeekOutlook
          open={open}
          onClose={onClose}
          todayHi={w.hi}
          todayLo={w.lo}
          days={days}
        />
      ),
    },
  ];

  return { variants, loading: false };
}

export const weatherModalEntry: TileModalEntry = {
  tileId: "tile_weath",
  defaultSlug: "hourly-temp-curve",
  useVariants: useWeatherVariants,
};
