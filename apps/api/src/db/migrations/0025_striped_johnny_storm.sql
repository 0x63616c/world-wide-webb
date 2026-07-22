DROP INDEX "notification_unread_idx";--> statement-breakpoint
CREATE INDEX "notification_unread_idx" ON "notification" USING btree ("created_at" DESC NULLS LAST) WHERE "notification"."read_at" is null;--> statement-breakpoint
ALTER TABLE "notification" DROP COLUMN "dismissed_at";