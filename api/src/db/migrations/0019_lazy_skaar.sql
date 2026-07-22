CREATE TABLE "device_push_token" (
	"device_id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"platform" text NOT NULL,
	"device_name" text,
	"push_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"category" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"deep_link" text,
	"data" jsonb,
	"read_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"dedupe_key" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_dedupe_key_idx" ON "notification" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "notification_created_at_idx" ON "notification" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notification_unread_idx" ON "notification" USING btree ("created_at" DESC NULLS LAST) WHERE "notification"."read_at" is null and "notification"."dismissed_at" is null;