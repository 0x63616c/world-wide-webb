// WMO weather interpretation codes -> human-readable condition string
export const WEATHER_CODES: Record<number, string> = {
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
export function weatherIcon(code: number, isDay: number): string {
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

// Format an ISO local datetime "2024-01-01T18:52" as "h:mm AM/PM"
export function formatSolarEvent(iso: string): string {
  const parts = iso.match(/T(\d+):(\d+)/);
  if (!parts) return iso;
  let h = parseInt(parts[1], 10);
  const m = parts[2];
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}
