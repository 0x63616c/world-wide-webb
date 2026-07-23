// Weather readings (Track C, Wave 7 fold). The codegen collects every
// exported `pgTable` from a feature's schema.ts into the generated schema
// barrel (features/_generated/schema.gen.ts), which drizzle-kit reads.
//
// Append-only weather readings. The weather-ingest poller inserts a fresh row
// per forecast hour every cycle (never upserts), so we keep the full history of
// how each hour's forecast drifted run-over-run. `kind` separates forward
// forecasts from settled observed actuals (predicted-vs-actual = join on
// target_hour). The dashboard reads the latest row per target_hour.
import { boolean, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const weatherReading = pgTable(
  "weather_reading",
  {
    id: serial("id").primaryKey(),
    kind: text("kind").notNull(), // 'forecast' | 'observed'
    targetHour: timestamp("target_hour", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    tempF: integer("temp_f").notNull(),
    feelsF: integer("feels_f").notNull(),
    humidity: integer("humidity"),
    weatherCode: integer("weather_code").notNull(),
    windMph: integer("wind_mph"),
    isDay: boolean("is_day").notNull(),
    precipProbability: integer("precip_probability"),
    uvIndex: integer("uv_index"),
  },
  (t) => [
    index("weather_reading_kind_target_recorded_idx").on(t.kind, t.targetHour, t.recordedAt),
    // Serves the 30-day retention purge's `recorded_at < cutoff` predicate. The
    // composite index above can't: recorded_at is its trailing column.
    index("weather_reading_recorded_at_idx").on(t.recordedAt),
  ],
);

// Daily-grain readings (today's hi/lo + sun times, plus the 7-day outlook).
// Separate table because this is a per-day grain that cannot live in a per-hour
// row. Append-only, same drift property as weather_reading.
export const weatherDailyReading = pgTable(
  "weather_daily_reading",
  {
    id: serial("id").primaryKey(),
    targetDate: text("target_date").notNull(), // YYYY-MM-DD (matches DailyItem.date)
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    hiF: integer("hi_f").notNull(),
    loF: integer("lo_f").notNull(),
    weatherCode: integer("weather_code").notNull(),
    precipProbability: integer("precip_probability"),
    sunriseIso: text("sunrise_iso"),
    sunsetIso: text("sunset_iso"),
  },
  (t) => [
    index("weather_daily_target_recorded_idx").on(t.targetDate, t.recordedAt),
    // Serves the 30-day retention purge, same reason as weather_reading's.
    index("weather_daily_recorded_at_idx").on(t.recordedAt),
  ],
);
