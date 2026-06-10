CREATE TABLE "portal_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"mac" text NOT NULL,
	"kind" text NOT NULL,
	"wrong_count" integer DEFAULT 0 NOT NULL,
	"window_started_at_utc" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until_utc" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "portal_authorization" (
	"id" text PRIMARY KEY NOT NULL,
	"mac" text NOT NULL,
	"guest_id" text NOT NULL,
	"granted_at_utc" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at_utc" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_code" (
	"id" text PRIMARY KEY NOT NULL,
	"guest_id" text NOT NULL,
	"code" text NOT NULL,
	"expires_at_utc" timestamp with time zone NOT NULL,
	"consumed" boolean DEFAULT false NOT NULL,
	"created_at_utc" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_guest" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"created_at_utc" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "portal_authorization" ADD CONSTRAINT "portal_authorization_guest_id_portal_guest_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."portal_guest"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_code" ADD CONSTRAINT "portal_code_guest_id_portal_guest_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."portal_guest"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "portal_attempt_mac_kind_idx" ON "portal_attempt" USING btree ("mac","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_authorization_mac_idx" ON "portal_authorization" USING btree ("mac");--> statement-breakpoint
CREATE INDEX "portal_code_guest_consumed_idx" ON "portal_code" USING btree ("guest_id","consumed");