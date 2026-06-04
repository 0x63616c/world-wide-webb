CREATE TABLE "weather_daily_reading" (
	"id" serial PRIMARY KEY NOT NULL,
	"target_date" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"hi_f" integer NOT NULL,
	"lo_f" integer NOT NULL,
	"weather_code" integer NOT NULL,
	"precip_probability" integer,
	"sunrise_iso" text,
	"sunset_iso" text
);
--> statement-breakpoint
CREATE TABLE "weather_reading" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"target_hour" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"temp_f" integer NOT NULL,
	"feels_f" integer NOT NULL,
	"humidity" integer,
	"weather_code" integer NOT NULL,
	"wind_mph" integer,
	"is_day" boolean NOT NULL,
	"precip_probability" integer,
	"uv_index" integer
);
--> statement-breakpoint
CREATE INDEX "weather_daily_target_recorded_idx" ON "weather_daily_reading" USING btree ("target_date","recorded_at");--> statement-breakpoint
CREATE INDEX "weather_reading_kind_target_recorded_idx" ON "weather_reading" USING btree ("kind","target_hour","recorded_at");
