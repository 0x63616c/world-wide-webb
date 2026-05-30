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

// Icon set: sun | moon | cloud | cloud-sun, derived from code + is_day
function weatherIcon(code: number, isDay: number): string {
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

// Placeholder data mirrors wf-kit.jsx DATA.now / DATA.hours for graceful degradation
const PLACEHOLDER_NOW: WeatherNow = {
  temp: 74,
  cond: "Partly Cloudy",
  hi: 79,
  lo: 61,
  feels: 75,
  hum: 56,
  wind: 8,
  sunset: "7:58 PM",
  city: "Los Angeles",
};

const PLACEHOLDER_HOURLY: HourlyItem[] = [
  { t: "Now", temp: 74, feels: 75, ic: "cloud-sun" },
  { t: "2", temp: 76, feels: 76, ic: "sun" },
  { t: "3", temp: 78, feels: 78, ic: "sun" },
  { t: "4", temp: 79, feels: 79, ic: "sun" },
  { t: "5", temp: 77, feels: 77, ic: "cloud-sun" },
  { t: "6", temp: 73, feels: 72, ic: "cloud" },
  { t: "7", temp: 70, feels: 69, ic: "cloud" },
  { t: "8", temp: 68, feels: 67, ic: "moon" },
  { t: "9", temp: 66, feels: 65, ic: "moon" },
  { t: "10", temp: 65, feels: 64, ic: "moon" },
  { t: "11", temp: 64, feels: 63, ic: "moon" },
  { t: "12", temp: 63, feels: 62, ic: "moon" },
];

// Format a Date as "h:mm AM/PM" in the local timezone
function formatSunset(iso: string): string {
  // Open-Meteo sunset is a local datetime string like "2024-01-01T18:52"
  // Parse as local time parts directly to avoid timezone drift
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
    `&daily=temperature_2m_max,temperature_2m_min,sunset` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=1`;

  let data: OpenMeteoCurrentResponse;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = (await res.json()) as OpenMeteoCurrentResponse;
  } catch {
    return PLACEHOLDER_NOW;
  }

  const c = data.current;
  return {
    temp: Math.round(c.temperature_2m),
    cond: WEATHER_CODES[c.weather_code] ?? "Unknown",
    hi: Math.round(data.daily.temperature_2m_max[0] ?? PLACEHOLDER_NOW.hi),
    lo: Math.round(data.daily.temperature_2m_min[0] ?? PLACEHOLDER_NOW.lo),
    feels: Math.round(c.apparent_temperature),
    hum: Math.round(c.relative_humidity_2m),
    wind: Math.round(c.wind_speed_10m),
    sunset: formatSunset(data.daily.sunset[0] ?? ""),
    city: "Los Angeles",
  };
}

// Fetch next 12 hourly slots from current hour from Open-Meteo
export async function fetchWeatherHourly(lat = env.LAT, lon = env.LON): Promise<HourlyItem[]> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&hourly=temperature_2m,apparent_temperature,weather_code,is_day` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=2`;

  let data: OpenMeteoHourlyResponse;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = (await res.json()) as OpenMeteoHourlyResponse;
  } catch {
    return PLACEHOLDER_HOURLY;
  }

  // Find the index of the current hour in the hourly time array
  const now = new Date();
  const currentHourStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T${String(now.getHours()).padStart(2, "0")}:00`;
  let startIdx = data.hourly.time.indexOf(currentHourStr);
  if (startIdx === -1) startIdx = 0;

  const slice = data.hourly.time.slice(startIdx, startIdx + 12);
  if (slice.length === 0) return PLACEHOLDER_HOURLY;

  return slice.map((timeStr, i) => {
    const idx = startIdx + i;
    const parts = timeStr.match(/T(\d+):/);
    const hour = parts ? parseInt(parts[1], 10) : 0;
    const label =
      i === 0
        ? "Now"
        : hour === 0
          ? "12a"
          : hour < 12
            ? String(hour)
            : hour === 12
              ? "12p"
              : String(hour - 12);
    return {
      t: label,
      temp: Math.round(data.hourly.temperature_2m[idx] ?? 0),
      feels: Math.round(data.hourly.apparent_temperature[idx] ?? 0),
      ic: weatherIcon(data.hourly.weather_code[idx] ?? 0, data.hourly.is_day[idx] ?? 1),
    };
  });
}
