CREATE TABLE "weight_measurement" (
	"id" text PRIMARY KEY NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"weight_kg" double precision NOT NULL,
	"body_metrics" jsonb,
	"source" text NOT NULL,
	"excluded_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weight_measurement_measured_at_unique" UNIQUE("measured_at")
);
--> statement-breakpoint
CREATE INDEX "weight_measurement_measured_at_idx" ON "weight_measurement" USING btree ("measured_at");