CREATE TABLE "latest_release" (
	"app" text PRIMARY KEY NOT NULL,
	"build" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "latest_release_positive_build" CHECK ("latest_release"."build" > 0)
);
