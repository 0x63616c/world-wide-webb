-- www-p9hx: captive portal goes password-only. Remove the email/OTP + per-MAC
-- lock surface (portal_code, portal_guest, portal_attempt), drop the guest_id
-- FK/column from portal_authorization (MAC is now the sole identity), and add
-- the global daily wrong-password rate-limit singleton (portal_rate_limit).
ALTER TABLE "portal_authorization" DROP COLUMN "guest_id";
--> statement-breakpoint
DROP TABLE "portal_code";
--> statement-breakpoint
DROP TABLE "portal_attempt";
--> statement-breakpoint
DROP TABLE "portal_guest";
--> statement-breakpoint
CREATE TABLE "portal_rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"date_utc" text NOT NULL,
	"wrong_attempts" integer DEFAULT 0 NOT NULL,
	"updated_at_utc" timestamp with time zone DEFAULT now() NOT NULL
);
