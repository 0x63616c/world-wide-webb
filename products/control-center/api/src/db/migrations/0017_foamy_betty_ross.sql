CREATE TABLE "github_poll_status" (
	"id" text PRIMARY KEY NOT NULL,
	"last_polled_at_utc" timestamp with time zone,
	"last_error" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"deployed_sha" text,
	"deployed_run_id" bigint,
	"deployed_at_utc" timestamp with time zone,
	"main_head_sha" text,
	"commits_behind" integer DEFAULT 0 NOT NULL,
	"updated_at_utc" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_run" (
	"id" bigint PRIMARY KEY NOT NULL,
	"run_number" integer NOT NULL,
	"workflow_name" text NOT NULL,
	"head_sha" text NOT NULL,
	"commit_message" text,
	"commit_author" text,
	"status" text NOT NULL,
	"conclusion" text,
	"deploy_job_conclusion" text,
	"failed_job_id" bigint,
	"failed_job_name" text,
	"failed_step_name" text,
	"current_job_name" text,
	"current_step_name" text,
	"started_at_utc" timestamp with time zone NOT NULL,
	"completed_at_utc" timestamp with time zone,
	"changed_file_count" integer,
	"additions" integer,
	"deletions" integer,
	"html_url" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_run_log_tail" (
	"run_id" bigint PRIMARY KEY NOT NULL,
	"job_id" bigint NOT NULL,
	"log_tail" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"fetched_at_utc" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "github_run_started_at_idx" ON "github_run" USING btree ("started_at_utc");