DROP INDEX "media_source_kind_idx";--> statement-breakpoint
DROP INDEX "job_claim_idx";--> statement-breakpoint
CREATE INDEX "job_claim_idx" ON "job" USING btree ("status","type","run_after","priority");--> statement-breakpoint
ALTER TABLE "job" DROP COLUMN "locked_by";--> statement-breakpoint
ALTER TABLE "job" DROP COLUMN "result";--> statement-breakpoint
ALTER TABLE "media_item" DROP COLUMN "clean_title";--> statement-breakpoint
ALTER TABLE "media_item" DROP COLUMN "artist";--> statement-breakpoint
ALTER TABLE "media_item" DROP COLUMN "event";--> statement-breakpoint
ALTER TABLE "media_item" DROP COLUMN "category";--> statement-breakpoint
ALTER TABLE "media_item" DROP COLUMN "audio_path";--> statement-breakpoint
ALTER TABLE "media_item" DROP COLUMN "audio_bytes";--> statement-breakpoint
ALTER TABLE "media_item" DROP COLUMN "error";--> statement-breakpoint
ALTER TABLE "media_item" DROP COLUMN "retries";--> statement-breakpoint
ALTER TABLE "media_source" DROP COLUMN "kind";--> statement-breakpoint
ALTER TABLE "media_source" DROP COLUMN "video_policy";