CREATE TABLE "wake_photo" (
	"path" text PRIMARY KEY NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"interaction_session_id" text,
	"device_id" text,
	"frame_idx" integer,
	"bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "wake_photo_session_idx" ON "wake_photo" USING btree ("interaction_session_id");--> statement-breakpoint
CREATE INDEX "wake_photo_captured_at_idx" ON "wake_photo" USING btree ("captured_at");