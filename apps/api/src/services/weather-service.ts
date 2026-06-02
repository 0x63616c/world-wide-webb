import { env } from "../env";

// WMO weather interpretation codes -> human-readable condition string
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

// Icon set: sun | moon | cloud | cloud-sun, derived from code + is_day.
function weatherIcon(code: number, isDay: number): string {
  if (code === 3) return "cloud";
  if (code >= 45) return "cloud";
  if (code >= 2) return isDay ? "cloud-sun" : "cloud";
  return isDay ? "sun" : "moon";
}

export interface WeatherNow {
  temp: number;
  cond: string;
  ic: string;
  hi: number;
  lo: number;
  feels: number;
  hum: number;
  wind: number;
  uvIndex: number;
  precipProbability: number;
  sunset: string;
  sunsetIso: string;
  sunrise: string;
  sunriseIso: string;
  tomorrowSunriseIso: string;
  city: string;
}

export interface HourlyItem {
  t: string;
  temp: number;
  feels: number;
  ic: string;
  isDay: boolean;
  isoTime: string;
  weatherCode: number;
}

export interface DailyItem {
  date: string;
  hi: number;
  lo: number;
  weatherCode: number;
  precipProbability: number | null;
}

interface OpenMeteoCurrentResponse {
  current: {
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    weather_code: number;
    wind_speed_10m: number;
    is_day: number;
    uv_index: number;
  };
  daily: {
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    sunset: string[];
    sunrise: string[];
  };
  hourly: {
    time: string[];
    precipitation_probability: number[];
  };
}

interface OpenMeteoHourlyResponse {
  hourly: {
    time: string[];
    temperature_2m: number[];
    apparent_temperature: number[];
    weather_code: number[];
    is_day: number[];
  };
}

interface OpenMeteoDailyResponse {
  daily: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    weather_code: number[];
    precipitation_probability_max: (number | null)[];
  };
}

// Format an ISO local datetime "2024-01-01T18:52" as "h:mm AM/PM"
function formatSolarEvent(iso: string): string {
  const parts = iso.match(/T(\d+):(\d+)/);
  if (!parts) return iso;
  let h = parseInt(parts[1], 10);
  const m = parts[2];
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

// Fetch current weather conditions from Open-Meteo (no API key required)
export async function fetchWeatherNow(lat = env.LAT, lon = env.LON): Promise<WeatherNow> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day,uv_index` +
    `&hourly=precipitation_probability` +
    `&daily=temperature_2m_max,temperature_2m_min,sunset,sunrise` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=2`;

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as OpenMeteoCurrentResponse;

  const c = data.current;
  const sunsetIso = data.daily.sunset[0] ?? "";
  const sunriseIso = data.daily.sunrise[0] ?? "";
  const tomorrowSunriseIso = data.daily.sunrise[1] ?? "";

  // Nearest-hour precipitation probability: align the hourly series to the
  // current local hour (timezone=auto), same logic as fetchWeatherHourly.
  const hourStart = new Date();
  hourStart.setMinutes(0, 0, 0);
  const hourTimes = data.hourly?.time ?? [];
  let precipIdx = hourTimes.findIndex((t) => new Date(t).getTime() >= hourStart.getTime());
  if (precipIdx < 0) precipIdx = 0;
  const precipProbability = Math.round(data.hourly?.precipitation_probability?.[precipIdx] ?? 0);

  return {
    temp: Math.round(c.temperature_2m),
    cond: WEATHER_CODES[c.weather_code] ?? "Unknown",
    ic: weatherIcon(c.weather_code, c.is_day),
    hi: Math.round(data.daily.temperature_2m_max[0] ?? 0),
    lo: Math.round(data.daily.temperature_2m_min[0] ?? 0),
    feels: Math.round(c.apparent_temperature),
    hum: Math.round(c.relative_humidity_2m),
    wind: Math.round(c.wind_speed_10m),
    uvIndex: Math.round(c.uv_index ?? 0),
    precipProbability,
    sunset: formatSolarEvent(sunsetIso),
    sunsetIso,
    sunrise: formatSolarEvent(sunriseIso),
    sunriseIso,
    tomorrowSunriseIso,
    city: "Los Angeles",
  };
}

// Fetch the next 12 hourly slots from Open-Meteo, starting at the current hour.
// Real data, no demo. Hour labels come from the actual clock so the axis reads
// correctly ("Now", then the next 12 local hours).
export async function fetchWeatherHourly(lat = env.LAT, lon = env.LON): Promise<HourlyItem[]> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&hourly=temperature_2m,apparent_temperature,weather_code,is_day` +
    `&temperature_unit=fahrenheit&timezone=auto&forecast_days=2`;

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as OpenMeteoHourlyResponse;

  const { time, temperature_2m, apparent_temperature, weather_code, is_day } = data.hourly;

  // Open-Meteo returns location-local times (timezone=auto); align to the
  // current local hour so the first slot is "Now".
  const hourStart = new Date();
  hourStart.setMinutes(0, 0, 0);
  let startIdx = time.findIndex((t) => new Date(t).getTime() >= hourStart.getTime());
  if (startIdx < 0) startIdx = 0;

  const out: HourlyItem[] = [];
  for (let i = startIdx; i < time.length && out.length < 24; i++) {
    const hour = new Date(time[i]).getHours();
    const h12 = hour % 12 || 12;
    out.push({
      t: out.length === 0 ? "Now" : String(h12),
      temp: Math.round(temperature_2m[i]),
      feels: Math.round(apparent_temperature[i]),
      ic: weatherIcon(weather_code[i], is_day[i]),
      isDay: is_day[i] === 1,
      isoTime: time[i],
      weatherCode: weather_code[i],
    });
  }
  return out;
}

// Fetch the 7-day daily forecast from Open-Meteo. Real data, same /v1/forecast
// endpoint. Index 0 is today.
export async function fetchWeatherDaily(lat = env.LAT, lon = env.LON): Promise<DailyItem[]> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max` +
    `&temperature_unit=fahrenheit&timezone=auto&forecast_days=7`;

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as OpenMeteoDailyResponse;

  const {
    time,
    temperature_2m_max,
    temperature_2m_min,
    weather_code,
    precipitation_probability_max,
  } = data.daily;

  const out: DailyItem[] = [];
  for (let i = 0; i < time.length; i++) {
    const p = precipitation_probability_max?.[i];
    out.push({
      date: time[i],
      hi: Math.round(temperature_2m_max[i]),
      lo: Math.round(temperature_2m_min[i]),
      weatherCode: weather_code[i],
      precipProbability: p == null ? null : Math.round(p),
    });
  }
  return out;
}
