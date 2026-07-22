CREATE TABLE "booth_photo" (
	"id" text PRIMARY KEY NOT NULL,
	"path" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"mode" text NOT NULL,
	"group_id" text NOT NULL,
	"frame_idx" integer DEFAULT 0 NOT NULL,
	"mime_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"device_id" text,
	"soft_deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booth_photo_path_unique" UNIQUE("path")
);
--> statement-breakpoint
CREATE INDEX "booth_photo_group_idx" ON "booth_photo" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "booth_photo_captured_at_idx" ON "booth_photo" USING btree ("captured_at");