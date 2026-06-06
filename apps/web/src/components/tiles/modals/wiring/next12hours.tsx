/**
 * Next 12 Hours tile (tile_hourly) — live wiring for its detail-modal variants.
 *
 * Shares the weather router with the Weather tile. Data sources (all live):
 *  - trpc.weather.hourly → 24-slot hourly forecast (t/temp/feels/ic/isDay/
 *                          isoTime/weatherCode). 12-slot variants take the head.
 *  - trpc.weather.now    → current temp/cond/ic + solar ISO/formatted times.
 *
 * The hourly endpoint returns a numeric weatherCode per slot but not the decoded
 * condition string; the WEATHER_CODES map here mirrors weather-service.ts so the
 * Condition Timeline can show full human text. This is decode logic, not data.
 */

import { Next12HoursModalComfortBand } from "@/components/tiles/modals/Next12HoursModalComfortBand";
import type { ConditionHourEntry } from "@/components/tiles/modals/Next12HoursModalConditionTimeline";
import { Next12HoursModalConditionTimeline } from "@/components/tiles/modals/Next12HoursModalConditionTimeline";
import { Next12HoursModalSkyClock } from "@/components/tiles/modals/Next12HoursModalSkyClock";
import type { ThermalHourEntry } from "@/components/tiles/modals/Next12HoursModalThermalDayArc";
import { Next12HoursModalThermalDayArc } from "@/components/tiles/modals/Next12HoursModalThermalDayArc";
import type { LiveVariant, TileModalEntry } from "@/components/tiles/modals/types";
import type { HourlyEntry } from "@/components/tiles/Next12HoursView";
import { POLL } from "@/lib/hooks";
import { trpc } from "@/lib/trpc";

const REFETCH = { refetchInterval: POLL.weather } as const;

// Format an ISO local datetime "2024-01-01T18:52" as "h:mm AM/PM" for display.
// Only needed in this view to convert raw ISO fields from the API.
function formatIso(iso: string): string {
  const parts = iso.match(/T(\d+):(\d+)/);
  if (!parts) return iso;
  let h = parseInt(parts[1], 10);
  const m = parts[2];
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

// WMO weather code → condition string. Mirrors WEATHER_CODES in
// apps/api/src/services/weather-service.ts (decode table, not invented data).
const WEATHER_CODES: Record<number, string> = {
  0: "Clear Sky",
  1: "Mainly Clear",
  2: "Partly Cloudy",
  3: "Overcast",
  45: "Foggy",
  48: "Depositing Rime Fog",
  51: "Light Drizzle",
  53: "Moderate Drizzle",
  55: "Dense Drizzle",
  61: "Slight Rain",
  63: "Moderate Rain",
  65: "Heavy Rain",
  71: "Slight Snow",
  73: "Moderate Snow",
  75: "Heavy Snow",
  77: "Snow Grains",
  80: "Slight Rain Showers",
  81: "Moderate Rain Showers",
  82: "Violent Rain Showers",
  85: "Slight Snow Showers",
  86: "Heavy Snow Showers",
  95: "Thunderstorm",
  96: "Thunderstorm with Slight Hail",
  99: "Thunderstorm with Heavy Hail",
};

type IconLiteral = "sun" | "moon" | "cloud" | "cloud-sun";

function useNext12HoursVariants(): { variants: LiveVariant[]; loading: boolean } {
  const hourly = trpc.weather.hourly.useQuery(undefined, REFETCH);
  const weather = trpc.weather.now.useQuery(undefined, REFETCH);

  const h = hourly.data;
  const w = weather.data;
  // Both queries gate the variant list so the switcher is stable and no variant
  // renders with partial live data.
  if (!h || !w) return { variants: [], loading: true };

  // 12-slot head for the comfort band / sky clock; full 24 for thermal arc.
  const head12 = h.slice(0, 12);

  const bandHours: HourlyEntry[] = head12.map((s) => ({
    t: s.t,
    temp: s.temp,
    feels: s.feels,
    ic: s.ic,
  }));

  const conditionHours: ConditionHourEntry[] = head12.map((s) => ({
    iso: s.isoTime,
    t: s.t,
    temp: s.temp,
    feels: s.feels,
    ic: s.ic as IconLiteral,
    cond: WEATHER_CODES[s.weatherCode] ?? "Unknown",
  }));

  const thermalHours: ThermalHourEntry[] = h.map((s) => ({
    isoTime: s.isoTime,
    label: s.t,
    temp: s.temp,
    feels: s.feels,
    weatherCode: s.weatherCode,
  }));

  const variants: LiveVariant[] = [
    {
      slug: "condition-timeline",
      label: "Timeline",
      render: (open, onClose) => (
        <Next12HoursModalConditionTimeline
          open={open}
          onClose={onClose}
          hours={conditionHours}
          sunsetIso={w.sunsetIso}
          sunriseIso={w.sunriseIso}
          tomorrowSunriseIso={w.tomorrowSunriseIso}
          sunset={formatIso(w.sunsetIso)}
          sunrise={formatIso(w.sunriseIso)}
        />
      ),
    },
    {
      slug: "comfort-band",
      label: "Comfort",
      render: (open, onClose) => (
        <Next12HoursModalComfortBand
          open={open}
          onClose={onClose}
          hours={bandHours}
          now={{ hi: w.hi, lo: w.lo, feels: w.feels }}
        />
      ),
    },
    {
      slug: "sky-clock",
      label: "Sky Clock",
      render: (open, onClose) => (
        <Next12HoursModalSkyClock
          open={open}
          onClose={onClose}
          hours={bandHours}
          now={{
            temp: w.temp,
            cond: w.cond,
            ic: w.ic,
            sunrise: formatIso(w.sunriseIso),
            sunriseIso: w.sunriseIso,
            sunset: formatIso(w.sunsetIso),
            sunsetIso: w.sunsetIso,
            tomorrowSunriseIso: w.tomorrowSunriseIso,
          }}
        />
      ),
    },
    {
      slug: "thermal-day-arc",
      label: "Thermal Arc",
      render: (open, onClose) => (
        <Next12HoursModalThermalDayArc
          open={open}
          onClose={onClose}
          hours={thermalHours}
          sunsetIso={w.sunsetIso}
          sunriseIso={w.sunriseIso}
          tomorrowSunriseIso={w.tomorrowSunriseIso}
        />
      ),
    },
  ];

  return { variants, loading: false };
}

export const next12HoursModalEntry: TileModalEntry = {
  tileId: "tile_hourly",
  defaultSlug: "condition-timeline",
  useVariants: useNext12HoursVariants,
};
