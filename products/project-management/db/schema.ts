import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: text("id").primaryKey(),
    ticketId: text("ticket_id").notNull(),
    workflowId: text("workflow_id").notNull(),
    runId: text("run_id"),
    phase: text("phase").notNull(),
    status: text("status").notNull(),
    builderAttempts: integer("builder_attempts").notNull().default(0),
    reviewerAttempts: integer("reviewer_attempts").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default({}),
  },
  (table) => [
    uniqueIndex("workflow_runs_workflow_id_idx").on(table.workflowId),
    index("workflow_runs_ticket_id_idx").on(table.ticketId),
    index("workflow_runs_status_idx").on(table.status),
  ],
);

export const workflowEvents = pgTable(
  "workflow_events",
  {
    id: text("id").primaryKey(),
    workflowRunId: text("workflow_run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    ticketId: text("ticket_id").notNull(),
    type: text("type").notNull(),
    phase: text("phase"),
    role: text("role"),
    outcome: text("outcome"),
    message: text("message"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb("metadata").notNull().default({}),
  },
  (table) => [
    index("workflow_events_workflow_run_id_idx").on(table.workflowRunId),
    index("workflow_events_ticket_id_idx").on(table.ticketId),
    index("workflow_events_occurred_at_idx").on(table.occurredAt),
  ],
);

export const workflowArtifacts = pgTable(
  "workflow_artifacts",
  {
    id: text("id").primaryKey(),
    workflowRunId: text("workflow_run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    ticketId: text("ticket_id").notNull(),
    kind: text("kind").notNull(),
    path: text("path").notNull(),
    bytes: integer("bytes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb("metadata").notNull().default({}),
  },
  (table) => [
    uniqueIndex("workflow_artifacts_path_idx").on(table.path),
    index("workflow_artifacts_workflow_run_id_idx").on(table.workflowRunId),
    index("workflow_artifacts_ticket_id_idx").on(table.ticketId),
  ],
);

export const ticketWorkflowRuns = pgTable(
  "ticket_workflow_run",
  {
    id: text("id").primaryKey(),
    ticketId: text("ticket_id").notNull(),
    phase: text("phase").notNull(),
    attempt: integer("attempt").notNull(),
    tmuxSession: text("tmux_session").notNull(),
    promptPath: text("prompt_path"),
    stdoutLogPath: text("stdout_log_path").notNull(),
    stderrLogPath: text("stderr_log_path").notNull(),
    stdout: text("stdout").notNull().default(""),
    stderr: text("stderr").notNull().default(""),
    stdoutBytes: integer("stdout_bytes").notNull().default(0),
    stderrBytes: integer("stderr_bytes").notNull().default(0),
    status: text("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("ticket_workflow_run_tmux_session_idx").on(table.tmuxSession),
    index("ticket_workflow_run_ticket_id_idx").on(table.ticketId),
    index("ticket_workflow_run_status_idx").on(table.status),
  ],
);

export const schema = {
  workflowRuns,
  workflowEvents,
  workflowArtifacts,
  ticketWorkflowRuns,
};
