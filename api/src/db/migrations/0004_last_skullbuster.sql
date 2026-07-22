CREATE TABLE "lamp_mode" (
	"id" text PRIMARY KEY NOT NULL,
	"mode" text DEFAULT 'none' NOT NULL,
	"speed" text,
	"updated_at_utc" timestamp with time zone DEFAULT now() NOT NULL
);
