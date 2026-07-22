CREATE TABLE "asc_build_status" (
	"id" text PRIMARY KEY NOT NULL,
	"build_number" integer NOT NULL,
	"marketing_version" text NOT NULL,
	"uploaded_at_utc" timestamp with time zone NOT NULL,
	"fetched_at_utc" timestamp with time zone DEFAULT now() NOT NULL
);
