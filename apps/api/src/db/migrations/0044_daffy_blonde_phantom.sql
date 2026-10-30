CREATE SEQUENCE "public"."notification_revision" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"source_module" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"deep_link" text NOT NULL,
	"priority" text NOT NULL,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"revision" bigint DEFAULT nextval('notification_revision') NOT NULL,
	CONSTRAINT "notifications_priority" CHECK ("notifications"."priority" IN ('low', 'normal', 'high', 'critical'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_active_dedupe" ON "notifications" USING btree ("source_module","dedupe_key") WHERE "notifications"."dismissed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "notifications_revision_idx" ON "notifications" USING btree ("revision");--> statement-breakpoint
CREATE INDEX "notifications_retention_idx" ON "notifications" USING btree ("dismissed_at");