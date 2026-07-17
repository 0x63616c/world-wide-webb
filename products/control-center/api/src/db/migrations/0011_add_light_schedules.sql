CREATE TABLE "light_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"days" jsonb NOT NULL,
	"trigger" jsonb NOT NULL,
	"action" jsonb NOT NULL,
	"target_ids" jsonb NOT NULL,
	"last_fired_date" text,
	"created_at_utc" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at_utc" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "light_schedules_enabled_idx" ON "light_schedules" USING btree ("enabled");