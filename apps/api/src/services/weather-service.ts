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
// Kept for when the live hourly feed replaces DEMO_HOURLY (www-42i).
function _weatherIcon(code: number, isDay: number): string {
  if (code === 3) return "cloud";
  if (code >= 45) return "cloud";
  if (code >= 2) return isDay ? "cloud-sun" : "cloud";
  return isDay ? "sun" : "moon";
}

export interface WeatherNow {
  temp: number;
  cond: string;
  hi: number;
  lo: number;
  feels: number;
  hum: number;
  wind: number;
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
}

interface OpenMeteoCurrentResponse {
  current: {
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    weather_code: number;
    wind_speed_10m: number;
    is_day: number;
  };
  daily: {
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    sunset: string[];
    sunrise: string[];
  };
}

// Kept for when the live hourly feed replaces DEMO_HOURLY (www-42i).
interface _OpenMeteoHourlyResponse {
  hourly: {
    time: string[];
    temperature_2m: number[];
    apparent_temperature: number[];
    weather_code: number[];
    is_day: number[];
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
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day` +
    `&daily=temperature_2m_max,temperature_2m_min,sunset,sunrise` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=2`;

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as OpenMeteoCurrentResponse;

  const c = data.current;
  const sunsetIso = data.daily.sunset[0] ?? "";
  const sunriseIso = data.daily.sunrise[0] ?? "";
  const tomorrowSunriseIso = data.daily.sunrise[1] ?? "";
  return {
    temp: Math.round(c.temperature_2m),
    cond: WEATHER_CODES[c.weather_code] ?? "Unknown",
    hi: Math.round(data.daily.temperature_2m_max[0] ?? 0),
    lo: Math.round(data.daily.temperature_2m_min[0] ?? 0),
    feels: Math.round(c.apparent_temperature),
    hum: Math.round(c.relative_humidity_2m),
    wind: Math.round(c.wind_speed_10m),
    sunset: formatSolarEvent(sunsetIso),
    sunsetIso,
    sunrise: formatSolarEvent(sunriseIso),
    sunriseIso,
    tomorrowSunriseIso,
    city: "Los Angeles",
  };
}

// ---------------------------------------------------------------------------
// DEMO_HOURLY — stable 12-hour demo payload used always until a reliable
// real-time hourly source lands. Lives in the backend only (www-42i).
// ---------------------------------------------------------------------------

export const DEMO_HOURLY: HourlyItem[] = [
  { t: "Now", temp: 74, feels: 72, ic: "cloud-sun" },
  { t: "2", temp: 76, feels: 74, ic: "sun" },
  { t: "3", temp: 78, feels: 76, ic: "sun" },
  { t: "4", temp: 79, feels: 77, ic: "sun" },
  { t: "5", temp: 77, feels: 75, ic: "cloud-sun" },
  { t: "6", temp: 74, feels: 72, ic: "cloud-sun" },
  { t: "7", temp: 71, feels: 69, ic: "cloud" },
  { t: "8", temp: 68, feels: 67, ic: "cloud" },
  { t: "9", temp: 66, feels: 64, ic: "moon" },
  { t: "10", temp: 64, feels: 63, ic: "moon" },
  { t: "11", temp: 63, feels: 61, ic: "moon" },
  { t: "12", temp: 62, feels: 60, ic: "moon" },
];

// Fetch next 12 hourly slots — returns DEMO_HOURLY always until a reliable
// real-time hourly source replaces it (www-42i).
// Params kept for API compatibility with the router; unused while demo is active.
export async function fetchWeatherHourly(_lat = env.LAT, _lon = env.LON): Promise<HourlyItem[]> {
  return DEMO_HOURLY;
}
