import { and, asc, desc, eq, gte } from "drizzle-orm";
import { db } from "../db/index";
import { weatherDailyReading, weatherReading } from "../db/schema";
import { env } from "../env";
import {
  type DailyItem,
  type HourlyItem,
  nextSolarEvent,
  WEATHER_CODES,
  type WeatherNow,
  weatherIcon,
} from "./weather-service";

function currentHour(): Date {
  const h = new Date();
  h.setMinutes(0, 0, 0);
  return h;
}

// Local calendar date as YYYY-MM-DD. Used to drop the past_days=1 rows the
// ingest stores (yesterday) so daily reads start at today, matching the
// frontend contract that index 0 is today.
function todayLocalDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Latest raw daily row per target_date from today onward, ascending (today
// first). String compare on YYYY-MM-DD is chronological. Shared by both daily
// reads so "today" is consistent.
async function latestDailyFromToday() {
  const rows = await db
    .select()
    .from(weatherDailyReading)
    .where(gte(weatherDailyReading.targetDate, todayLocalDate()))
    .orderBy(asc(weatherDailyReading.targetDate), desc(weatherDailyReading.recordedAt));
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (seen.has(r.targetDate)) return false;
    seen.add(r.targetDate);
    return true;
  });
}

// Rows for forecast hours from `start` onward, ordered targetHour ASC then
// recordedAt DESC so the first row seen for each hour is the most recently
// recorded forecast (the freshest prediction).
async function latestForecastFrom(start: Date) {
  return db
    .select()
    .from(weatherReading)
    .where(and(eq(weatherReading.kind, "forecast"), gte(weatherReading.targetHour, start)))
    .orderBy(asc(weatherReading.targetHour), desc(weatherReading.recordedAt));
}

// Collapse to one row per hour (first wins, given the ordering above), then cap
// and label "Now" at READ time so the first slot always tracks the live clock.
export async function readWeatherHourly(): Promise<HourlyItem[]> {
  const rows = await latestForecastFrom(currentHour());
  const seen = new Set<number>();
  const out: HourlyItem[] = [];
  for (const r of rows) {
    const key = r.targetHour.getTime();
    if (seen.has(key)) continue;
    seen.add(key);
    const hour = r.targetHour.getHours();
    const h12 = hour % 12 || 12;
    out.push({
      t: out.length === 0 ? "Now" : String(h12),
      temp: r.tempF,
      feels: r.feelsF,
      ic: weatherIcon(r.weatherCode, r.isDay ? 1 : 0),
      isDay: r.isDay,
      isoTime: r.targetHour.toISOString(),
      weatherCode: r.weatherCode,
    });
    if (out.length >= 24) break;
  }
  return out;
}

// Latest daily row per target_date, today first (yesterday's past_days row is
// filtered out by latestDailyFromToday).
export async function readWeatherDaily(): Promise<DailyItem[]> {
  const days = await latestDailyFromToday();
  return days.map((r) => ({
    date: r.targetDate,
    hi: r.hiF,
    lo: r.loF,
    weatherCode: r.weatherCode,
    precipProbability: r.precipProbability,
  }));
}

// Current conditions = current hour's forecast row + today's daily row (hi/lo +
// sun) + tomorrow's daily row (next sunrise). Throws (tile shimmers) if the
// ingest has not populated the DB yet , never invents numbers.
export async function readWeatherNow(): Promise<WeatherNow> {
  const hours = await latestForecastFrom(currentHour());
  const cur = hours[0];
  if (!cur) throw new Error("no current weather reading");

  const days = await latestDailyFromToday();
  const today = days[0];
  if (!today) throw new Error("no daily weather reading");
  const tomorrow = days[1];

  const sunsetIso = today.sunsetIso ?? "";
  const sunriseIso = today.sunriseIso ?? "";
  const tomorrowSunriseIso = tomorrow?.sunriseIso ?? "";

  // Solar event selection happens server-side so views receive a ready-to-display
  // label/value pair and do not need to re-implement the calendar logic (www-355t.24).
  const solar = nextSolarEvent(new Date(), sunsetIso, tomorrowSunriseIso);

  return {
    temp: cur.tempF,
    cond: WEATHER_CODES[cur.weatherCode] ?? "Unknown",
    ic: weatherIcon(cur.weatherCode, cur.isDay ? 1 : 0),
    hi: today.hiF,
    lo: today.loF,
    feels: cur.feelsF,
    hum: cur.humidity ?? 0,
    wind: cur.windMph ?? 0,
    uvIndex: cur.uvIndex ?? 0,
    precipProbability: cur.precipProbability ?? 0,
    sunsetIso,
    sunriseIso,
    tomorrowSunriseIso,
    solarLabel: solar.label,
    solarValue: solar.value,
    // Display label for the configured home location. Driven by HOME_PLACE_NAME
    // (delivered from 1Password via the secret rail; public placeholder in
    // dev/test) so the weather tile matches HOME_LAT/HOME_LON instead of a
    // hardcoded city (www-355t.14).
    city: env.HOME_PLACE_NAME,
  };
}
