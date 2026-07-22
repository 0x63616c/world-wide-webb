CREATE TABLE "device_settings" (
	"device_id" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at_utc" timestamp with time zone DEFAULT now() NOT NULL
);
