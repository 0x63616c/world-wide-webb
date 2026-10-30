CREATE TABLE "walk" (
	"id" text PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"source" text DEFAULT 'unknown' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "walk_date_order" CHECK ("walk"."ended_at" IS NULL OR "walk"."ended_at" >= "walk"."started_at"),
	CONSTRAINT "walk_source" CHECK ("walk"."source" IN ('iphone', 'ipad', 'web', 'unknown'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "walk_one_active_idx" ON "walk" USING btree ((1)) WHERE "walk"."ended_at" IS NULL AND "walk"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "walk_history_idx" ON "walk" USING btree ("started_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "walk"."ended_at" IS NOT NULL AND "walk"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "walk_updated_idx" ON "walk" USING btree ("updated_at" DESC NULLS LAST);