import { db } from "../db/index";
import { integrationSyncStatus, weatherDailyReading, weatherReading } from "../db/schema";
import { env } from "../env";

const INGEST_INTEGRATION_ID = "weather";
const INGEST_INTERVAL_MS = 5 * 60_000;

export interface OpenMeteoBundle {
  current: {
    time: string;
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    weather_code: number;
    wind_speed_10m: number;
    is_day: number;
    uv_index: number;
  };
  hourly: {
    time: string[];
    temperature_2m: number[];
    apparent_temperature: number[];
    relative_humidity_2m: number[];
    weather_code: number[];
    wind_speed_10m: number[];
    is_day: number[];
    precipitation_probability: number[];
  };
  daily: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    weather_code: number[];
    precipitation_probability_max: (number | null)[];
    sunrise: string[];
    sunset: string[];
  };
}

// One Open-Meteo call per ingest cycle. past_days=1 returns the recently settled
// hours (used to record observed actuals); forecast_days=7 gives 24h+ of forward
// hourly plus the 7-day daily outlook the week modal needs.
export async function fetchOpenMeteoBundle(lat = env.LAT, lon = env.LON): Promise<OpenMeteoBundle> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day,uv_index` +
    `&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day,precipitation_probability` +
    `&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,sunrise,sunset` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&past_days=1&forecast_days=7`;

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as OpenMeteoBundle;
}

// Round to the current wall-clock hour. timezone=auto means Open-Meteo's
// strings are already location-local, so a past hour < this boundary becomes an
// observed actual and the current hour and beyond become forecasts.
function hourBoundaryMs(): number {
  const h = new Date();
  h.setMinutes(0, 0, 0);
  return h.getTime();
}

export async function runWeatherIngestCycle(): Promise<void> {
  try {
    const bundle = await fetchOpenMeteoBundle();
    const now = new Date();
    const boundary = hourBoundaryMs();
    const h = bundle.hourly;

    const hourlyRows = h.time.map((iso, i) => {
      const target = new Date(iso);
      const isPast = target.getTime() < boundary;
      return {
        kind: isPast ? ("observed" as const) : ("forecast" as const),
        targetHour: target,
        recordedAt: now,
        tempF: Math.round(h.temperature_2m[i]),
        feelsF: Math.round(h.apparent_temperature[i]),
        humidity: Math.round(h.relative_humidity_2m[i]),
        weatherCode: h.weather_code[i],
        windMph: Math.round(h.wind_speed_10m[i]),
        isDay: h.is_day[i] === 1,
        precipProbability: h.precipitation_probability[i] ?? null,
        uvIndex: null as number | null, // uv only present on `current`, not hourly
      };
    });
    if (hourlyRows.length > 0) await db.insert(weatherReading).values(hourlyRows);

    const d = bundle.daily;
    const dailyRows = d.time.map((date, i) => ({
      targetDate: date,
      recordedAt: now,
      hiF: Math.round(d.temperature_2m_max[i]),
      loF: Math.round(d.temperature_2m_min[i]),
      weatherCode: d.weather_code[i],
      precipProbability:
        d.precipitation_probability_max[i] == null
          ? null
          : Math.round(d.precipitation_probability_max[i] as number),
      sunriseIso: d.sunrise[i] ?? null,
      sunsetIso: d.sunset[i] ?? null,
    }));
    if (dailyRows.length > 0) await db.insert(weatherDailyReading).values(dailyRows);

    await markHeartbeat(null);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markHeartbeat(msg);
  }
}

async function markHeartbeat(error: string | null): Promise<void> {
  const now = new Date();
  await db
    .insert(integrationSyncStatus)
    .values({
      integrationId: INGEST_INTEGRATION_ID,
      lastPolledAtUtc: now,
      lastError: error,
      consecutiveFailures: 0,
    })
    .onConflictDoUpdate({
      target: integrationSyncStatus.integrationId,
      set: { lastPolledAtUtc: now, lastError: error, consecutiveFailures: 0 },
    });
}

export interface WeatherIngestHandle {
  stop: () => void;
}

// In-process poller mirroring startDeviceSyncService: runs one cycle, then
// schedules the next INGEST_INTERVAL_MS later. Started once at boot.
export function startWeatherIngestService(): WeatherIngestHandle {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    await runWeatherIngestCycle();
    if (stopped) return;
    setTimeout(tick, INGEST_INTERVAL_MS);
  };
  void tick();
  return {
    stop: () => {
      stopped = true;
    },
  };
}
