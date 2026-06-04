import { z } from "zod";
import {
  readWeatherDaily,
  readWeatherHourly,
  readWeatherNow,
} from "../../services/weather-read-service";
import { publicProcedure, router } from "../init";

const WeatherNowOutput = z.object({
  temp: z.number().describe("Current temperature in °F"),
  cond: z.string().describe("Condition description (e.g. 'Partly Cloudy')"),
  ic: z
    .string()
    .describe("Icon name derived from weather_code + is_day: sun | moon | cloud | cloud-sun"),
  hi: z.number().describe("Today's high in °F"),
  lo: z.number().describe("Today's low in °F"),
  feels: z.number().describe("Feels-like temperature in °F"),
  hum: z.number().describe("Relative humidity %"),
  wind: z.number().describe("Wind speed in mph"),
  uvIndex: z.number().describe("Current UV index 0-11+"),
  precipProbability: z.number().describe("Nearest-hour precipitation probability %"),
  sunset: z.string().describe("Sunset time formatted as h:mm AM/PM"),
  sunsetIso: z.string().describe("Sunset as ISO local datetime for client-side comparison"),
  sunrise: z.string().describe("Sunrise time formatted as h:mm AM/PM"),
  sunriseIso: z.string().describe("Sunrise as ISO local datetime for client-side comparison"),
  tomorrowSunriseIso: z.string().describe("Tomorrow's sunrise ISO local datetime"),
  city: z.string().describe("City label for display"),
});

const HourlyItemOutput = z.object({
  t: z.string().describe('Hour label: "Now" for current, then hour number (e.g. "2", "3")'),
  temp: z.number().describe("Temperature in °F"),
  feels: z.number().describe("Feels-like temperature in °F"),
  ic: z.string().describe("Icon name: sun | moon | cloud | cloud-sun"),
  isDay: z.boolean().describe("True when the sun is up for this slot (is_day)"),
  isoTime: z.string().describe("Full Open-Meteo local datetime for this slot"),
  weatherCode: z.number().describe("WMO weather code for this slot"),
});

const DailyItemOutput = z.object({
  date: z.string().describe("ISO date YYYY-MM-DD"),
  hi: z.number().describe("Daily high in °F"),
  lo: z.number().describe("Daily low in °F"),
  weatherCode: z.number().describe("WMO weather code for the day"),
  precipProbability: z.number().nullable().describe("Max precipitation probability %, or null"),
});

export const weatherRouter = router({
  /**
   * Current weather conditions for the dashboard weather tile.
   * Source: weather_reading + weather_daily_reading (Postgres), populated by
   * the weather-ingest poller. Throws if the DB is empty (tile shimmers).
   */
  now: publicProcedure
    .input(z.object({}).optional())
    .output(WeatherNowOutput)
    .query(() => readWeatherNow()),

  /**
   * Next 12 hourly slots from the current hour for the hourly strip tile.
   * Source: weather_reading (Postgres). "Now" is computed at read time so the
   * first slot always tracks the live clock. Throws if empty (tile shimmers).
   */
  hourly: publicProcedure
    .input(z.object({}).optional())
    .output(z.array(HourlyItemOutput))
    .query(() => readWeatherHourly()),

  /**
   * 7-day daily forecast for the weather week-outlook modal.
   * Source: weather_daily_reading (Postgres). Throws on failure (tile shimmers).
   */
  daily: publicProcedure
    .input(z.object({}).optional())
    .output(z.array(DailyItemOutput))
    .query(() => readWeatherDaily()),
});
