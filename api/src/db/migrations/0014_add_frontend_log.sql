CREATE TABLE "frontend_log" (
	"device_id" text NOT NULL,
	"entry_id" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"level" text NOT NULL,
	"source" text NOT NULL,
	"msg" text NOT NULL,
	"data" jsonb,
	"sha" text NOT NULL,
	"build" text NOT NULL,
	"device_name" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "frontend_log_device_id_entry_id_pk" PRIMARY KEY("device_id","entry_id")
);
--> statement-breakpoint
CREATE INDEX "frontend_log_ts_idx" ON "frontend_log" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "frontend_log_level_ts_idx" ON "frontend_log" USING btree ("level","ts");