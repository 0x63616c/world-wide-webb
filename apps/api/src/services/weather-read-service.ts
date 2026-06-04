import { and, asc, desc, eq, gte } from "drizzle-orm";
import { db } from "../db/index";
import { weatherReading } from "../db/schema";
import { type HourlyItem, weatherIcon } from "./weather-service";

function currentHour(): Date {
  const h = new Date();
  h.setMinutes(0, 0, 0);
  return h;
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
