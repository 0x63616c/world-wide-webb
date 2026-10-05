CREATE TABLE "alarm_ring" (
	"id" text PRIMARY KEY NOT NULL,
	"alarm_id" text NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"label" text NOT NULL,
	"status" text NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"ring_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"snooze_minutes" integer NOT NULL,
	"light_target" text NOT NULL,
	"lights_delivered_at" timestamp with time zone,
	"lights_retry_at" timestamp with time zone NOT NULL,
	"lights_attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alarm" (
	"id" text PRIMARY KEY NOT NULL,
	"definition" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"next_fire_at" timestamp with time zone,
	"request_key" text,
	"request_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alarm_ring" ADD CONSTRAINT "alarm_ring_alarm_id_alarm_id_fk" FOREIGN KEY ("alarm_id") REFERENCES "public"."alarm"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alarm_ring_occurrence_idx" ON "alarm_ring" USING btree ("alarm_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "alarm_ring_pending_idx" ON "alarm_ring" USING btree ("status","ring_at");--> statement-breakpoint
CREATE INDEX "alarm_due_idx" ON "alarm" USING btree ("enabled","next_fire_at");--> statement-breakpoint
CREATE UNIQUE INDEX "alarm_request_key_idx" ON "alarm" USING btree ("request_key");