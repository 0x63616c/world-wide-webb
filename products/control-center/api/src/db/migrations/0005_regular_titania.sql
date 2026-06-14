CREATE TABLE "media_item" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"yt_video_id" text NOT NULL,
	"raw_title" text NOT NULL,
	"clean_title" text,
	"artist" text,
	"event" text,
	"category" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"audio_path" text,
	"video_path" text,
	"thumb_path" text,
	"audio_bytes" integer,
	"video_bytes" integer,
	"duration_sec" integer,
	"error" text,
	"retries" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_source" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"external_id" text,
	"url" text,
	"title" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"video_policy" text DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media_item" ADD CONSTRAINT "media_item_source_id_media_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."media_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_item_yt_video_id_idx" ON "media_item" USING btree ("yt_video_id");--> statement-breakpoint
CREATE INDEX "media_item_source_id_idx" ON "media_item" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "media_item_status_idx" ON "media_item" USING btree ("status");--> statement-breakpoint
CREATE INDEX "media_source_kind_idx" ON "media_source" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "media_source_enabled_idx" ON "media_source" USING btree ("enabled");