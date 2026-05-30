import { z } from "zod";
import { fetchWeatherHourly, fetchWeatherNow } from "../../services/weather-service";
import { publicProcedure, router } from "../init";

const WeatherNowOutput = z.object({
  temp: z.number().describe("Current temperature in °F"),
  cond: z.string().describe("Condition description (e.g. 'Partly Cloudy')"),
  hi: z.number().describe("Today's high in °F"),
  lo: z.number().describe("Today's low in °F"),
  feels: z.number().describe("Feels-like temperature in °F"),
  hum: z.number().describe("Relative humidity %"),
  wind: z.number().describe("Wind speed in mph"),
  sunset: z.string().describe("Sunset time formatted as h:mm AM/PM"),
  city: z.string().describe("City label for display"),
});

const HourlyItemOutput = z.object({
  t: z.string().describe('Hour label: "Now" for current, then hour number (e.g. "2", "3")'),
  temp: z.number().describe("Temperature in °F"),
  feels: z.number().describe("Feels-like temperature in °F"),
  ic: z.string().describe("Icon name: sun | moon | cloud | cloud-sun"),
});

export const weatherRouter = router({
  /**
   * Current weather conditions for the dashboard weather tile.
   * Source: Open-Meteo /v1/forecast. Degrades to placeholder on failure.
   */
  now: publicProcedure
    .input(z.object({}).optional())
    .output(WeatherNowOutput)
    .query(() => fetchWeatherNow()),

  /**
   * Next 12 hourly slots from the current hour for the hourly strip tile.
   * Source: Open-Meteo /v1/forecast hourly. Degrades to placeholder on failure.
   */
  hourly: publicProcedure
    .input(z.object({}).optional())
    .output(z.array(HourlyItemOutput))
    .query(() => fetchWeatherHourly()),
});
