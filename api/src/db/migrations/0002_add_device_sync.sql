CREATE TABLE IF NOT EXISTS "device_state" (
  "id" text PRIMARY KEY NOT NULL,
  "kind" text NOT NULL,
  "entity_id" text NOT NULL,
  "domain" text NOT NULL,
  "label" text NOT NULL,
  "reported_state" jsonb,
  "reported_at_utc" timestamp with time zone,
  "reported_changed_at_utc" timestamp with time zone,
  "desired_state" jsonb,
  "desired_at_utc" timestamp with time zone,
  "desired_until_utc" timestamp with time zone,
  "available" boolean NOT NULL DEFAULT false,
  "created_at_utc" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at_utc" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "device_state_entity_id_idx" ON "device_state" ("entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_state_kind_idx" ON "device_state" ("kind");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "device_commands" (
  "id" serial PRIMARY KEY NOT NULL,
  "device_id" text NOT NULL,
  "action" text NOT NULL,
  "args" jsonb NOT NULL,
  "status" text NOT NULL,
  "issued_at_utc" timestamp with time zone NOT NULL DEFAULT now(),
  "sent_at_utc" timestamp with time zone,
  "confirmed_at_utc" timestamp with time zone,
  "error" text,
  CONSTRAINT "device_commands_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device_state" ("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_commands_device_id_issued_idx" ON "device_commands" ("device_id", "issued_at_utc");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_commands_status_idx" ON "device_commands" ("status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "integration_sync_status" (
  "integration_id" text PRIMARY KEY NOT NULL,
  "last_polled_at_utc" timestamp with time zone,
  "last_error" text,
  "consecutive_failures" integer NOT NULL DEFAULT 0,
  "updated_at_utc" timestamp with time zone NOT NULL DEFAULT now()
);
