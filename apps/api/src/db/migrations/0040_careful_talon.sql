CREATE TABLE "sound_calibration" (
	"room_id" text PRIMARY KEY NOT NULL,
	"baseline" integer NOT NULL,
	"updated_at_utc" timestamp with time zone DEFAULT now() NOT NULL
);
