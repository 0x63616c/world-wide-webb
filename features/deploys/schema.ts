// Drizzle schema for the deploys feature (Track C, Wave 2 fold). Moved verbatim
// from apps/api/src/db/schema.ts — see the pointer comment left there.
import { bigint, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// GitHub Actions deploy poller (spec 2026-07-18-github-deploy-tile-design). The
// worker calls runGithubPollCycle on a 10s tick; the cycle self-gates to 60s
// while no run is in flight so the idle request rate stays at ~60/hr.
// "Currently deployed" is the newest run whose DEPLOY JOB concluded success
// (not merely the newest green run  --  path filters can skip deploy inside a
// successful run), which is why deploy_job_conclusion is a first-class column.
export const githubRun = pgTable(
  "github_run",
  {
    // GitHub's run id. bigint: GitHub ids are int64 and already past 2^31.
    id: bigint("id", { mode: "number" }).primaryKey(),
    runNumber: integer("run_number").notNull(),
    workflowName: text("workflow_name").notNull(),
    headSha: text("head_sha").notNull(),
    commitMessage: text("commit_message"),
    commitAuthor: text("commit_author"),
    status: text("status").notNull(), // 'queued' | 'in_progress' | 'completed'
    conclusion: text("conclusion"), // null while in flight
    // Conclusion of the run's `deploy` job: 'success' | 'failure' | 'skipped' |
    // null (job not finished / jobs not yet fetched). Drives "currently deployed".
    deployJobConclusion: text("deploy_job_conclusion"),
    // First failing job/step, for the tile's "failed" verdict; the failed job id
    // is what the log-tail fetch needs.
    failedJobId: bigint("failed_job_id", { mode: "number" }),
    failedJobName: text("failed_job_name"),
    failedStepName: text("failed_step_name"),
    // Job/step currently executing while the run is in flight (tile "deploying"
    // sub-line). Cleared once the run completes.
    currentJobName: text("current_job_name"),
    currentStepName: text("current_step_name"),
    startedAtUtc: timestamp("started_at_utc", { withTimezone: true }).notNull(),
    completedAtUtc: timestamp("completed_at_utc", { withTimezone: true }),
    // Diffstat from the commit detail endpoint; null until that one-time fetch.
    changedFileCount: integer("changed_file_count"),
    additions: integer("additions"),
    deletions: integer("deletions"),
    htmlUrl: text("html_url").notNull(),
  },
  (t) => [
    // Newest-first feed reads and the 30-day retention cutoff.
    index("github_run_started_at_idx").on(t.startedAtUtc),
  ],
);

// Last 4KB of the failed job's log, one row per run. Separate table so the
// blobs never ride the hot feed read. `attempts` caps the retry loop: job logs
// 404 for a few seconds after a job flips to failure, so the tail is fetched on
// later ticks with backoff rather than in the same cycle that saw the failure.
export const githubRunLogTail = pgTable("github_run_log_tail", {
  runId: bigint("run_id", { mode: "number" }).primaryKey(),
  jobId: bigint("job_id", { mode: "number" }).notNull(),
  logTail: text("log_tail"), // null until a fetch succeeds
  attempts: integer("attempts").notNull().default(0),
  fetchedAtUtc: timestamp("fetched_at_utc", { withTimezone: true }),
});

// Poll-state SINGLETON (id = GITHUB_POLL_STATUS_SINGLETON_ID): the staleness
// envelope (modeled on integration_sync_status) plus the denormalized
// currently-deployed pointer so the tile answers "what is deployed" in one
// read. NEVER purged  --  if the last deploy is 31 days old the history goes but
// this pointer stays (retention sweep must exclude it).
export const GITHUB_POLL_STATUS_SINGLETON_ID = "singleton";

export const githubPollStatus = pgTable("github_poll_status", {
  id: text("id").primaryKey(),
  lastPolledAtUtc: timestamp("last_polled_at_utc", { withTimezone: true }),
  lastError: text("last_error"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  deployedSha: text("deployed_sha"),
  deployedRunId: bigint("deployed_run_id", { mode: "number" }),
  deployedAtUtc: timestamp("deployed_at_utc", { withTimezone: true }),
  // Head of main as GitHub reports it (newest run's head sha).
  mainHeadSha: text("main_head_sha"),
  // Exact commit count deployed..head from the compare endpoint; 0 when equal.
  commitsBehind: integer("commits_behind").notNull().default(0),
  updatedAtUtc: timestamp("updated_at_utc", { withTimezone: true }).notNull().defaultNow(),
});
